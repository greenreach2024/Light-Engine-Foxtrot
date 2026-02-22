import { db } from "../../db/index.js";
import { NotFoundError, BadRequestError, ConflictError } from "../../shared/utils/errors.js";
import { isValidTransition, REQUIRED_DOC_TYPES } from "../../shared/types/driver-states.js";
import type { DriverOnboardingStatus } from "../../shared/types/driver-states.js";
import type {
  ApplyDriverInput,
  UploadDocInput,
  ReviewDocInput,
  SetupBankingInput,
  SignAgreementInput,
} from "./driver-onboarding.validation.js";

export class DriverOnboardingService {
  // ─── Apply ───────────────────────────────────────────────

  async apply(input: ApplyDriverInput) {
    // Check for existing application by email
    const existing = await db("users").where("email", input.email).first();
    if (existing) throw new ConflictError("A user with this email already exists");

    return db.transaction(async (trx) => {
      // Create user
      const [user] = await trx("users")
        .insert({
          email: input.email,
          password_hash: "pending_verification",
          role: "driver",
          first_name: input.first_name,
          last_name: input.last_name,
          phone: input.phone,
        })
        .returning("*");

      // Create driver record
      const [driver] = await trx("drivers")
        .insert({
          user_id: user.id,
          vehicle_type: mapVehicleType(input.vehicle_type),
          capacity_weight_kg: input.capacity_weight_kg ?? 0,
          capacity_volume_l: 0,
          capacity_totes: input.capacity_totes ?? 0,
          status: "applicant",
          preferred_zone: input.preferred_zone,
        })
        .returning("*");

      return { user, driver };
    });
  }

  // ─── Documents ───────────────────────────────────────────

  async uploadDocument(driverId: string, input: UploadDocInput) {
    await this.ensureDriver(driverId);
    const [doc] = await db("driver_documents")
      .insert({
        driver_id: driverId,
        doc_type: input.doc_type,
        file_url: input.file_url,
        file_name: input.file_name,
        file_size: input.file_size,
        expires_at: input.expires_at,
        status: "pending",
      })
      .returning("*");
    return doc;
  }

  async reviewDocument(docId: string, reviewerId: string, input: ReviewDocInput) {
    const [doc] = await db("driver_documents")
      .where("id", docId)
      .update({
        status: input.status,
        reviewed_by: reviewerId,
        reviewed_at: new Date(),
        reject_reason: input.reject_reason,
        updated_at: new Date(),
      })
      .returning("*");
    if (!doc) throw new NotFoundError("Document", docId);

    // Auto-advance if all required docs accepted
    if (input.status === "accepted") {
      await this.tryAdvanceFromDocs(doc.driver_id);
    }

    return doc;
  }

  async listDocuments(driverId: string) {
    return db("driver_documents")
      .where("driver_id", driverId)
      .orderBy("created_at", "desc");
  }

  // ─── Background Check ────────────────────────────────────

  async submitBackgroundCheck(driverId: string, input: { provider?: string; provider_ref?: string }) {
    await this.ensureDriver(driverId);
    const [check] = await db("driver_background_checks")
      .insert({
        driver_id: driverId,
        status: "submitted",
        provider: input.provider ?? "internal",
        provider_ref: input.provider_ref,
        submitted_at: new Date(),
      })
      .returning("*");
    return check;
  }

  async updateBackgroundCheck(checkId: string, status: "passed" | "failed") {
    const [check] = await db("driver_background_checks")
      .where("id", checkId)
      .update({ status, completed_at: new Date(), updated_at: new Date() })
      .returning("*");
    if (!check) throw new NotFoundError("BackgroundCheck", checkId);

    if (status === "passed") {
      await this.transitionStatus(check.driver_id, "bg_check", "banking");
    }

    return check;
  }

  async getBackgroundCheck(driverId: string) {
    return db("driver_background_checks")
      .where("driver_id", driverId)
      .orderBy("created_at", "desc")
      .first();
  }

  // ─── Banking ─────────────────────────────────────────────

  async setupBanking(driverId: string, input: SetupBankingInput) {
    await this.ensureDriver(driverId);

    const existing = await db("driver_payout_accounts").where("driver_id", driverId).first();
    if (existing) {
      const [account] = await db("driver_payout_accounts")
        .where("driver_id", driverId)
        .update({
          stripe_account_id: input.stripe_account_id,
          bank_last4: input.bank_last4,
          account_status: "pending",
          updated_at: new Date(),
        })
        .returning("*");
      return account;
    }

    const [account] = await db("driver_payout_accounts")
      .insert({
        driver_id: driverId,
        stripe_account_id: input.stripe_account_id,
        bank_last4: input.bank_last4,
        account_status: "pending",
      })
      .returning("*");

    // Update driver's stripe_connect_id
    await db("drivers")
      .where("id", driverId)
      .update({ stripe_connect_id: input.stripe_account_id, updated_at: new Date() });

    return account;
  }

  async verifyBanking(driverId: string) {
    const [account] = await db("driver_payout_accounts")
      .where("driver_id", driverId)
      .update({
        account_status: "verified",
        payouts_enabled: true,
        updated_at: new Date(),
      })
      .returning("*");
    if (!account) throw new NotFoundError("PayoutAccount", driverId);

    await this.transitionStatus(driverId, "banking", "agreement");
    return account;
  }

  // ─── Agreements ──────────────────────────────────────────

  async signAgreement(driverId: string, input: SignAgreementInput) {
    await this.ensureDriver(driverId);

    // Supersede any existing agreement of same type
    await db("driver_agreements")
      .where("driver_id", driverId)
      .where("agreement_type", input.agreement_type)
      .where("status", "signed")
      .update({ status: "superseded" });

    const [agreement] = await db("driver_agreements")
      .insert({
        driver_id: driverId,
        agreement_type: input.agreement_type,
        version: input.version,
        status: "signed",
        signed_at: new Date(),
        ip_address: input.ip_address,
      })
      .returning("*");

    // Check if both required agreements are signed
    await this.tryAdvanceFromAgreements(driverId);

    return agreement;
  }

  async listAgreements(driverId: string) {
    return db("driver_agreements")
      .where("driver_id", driverId)
      .orderBy("created_at", "desc");
  }

  // ─── Onboarding Status ──────────────────────────────────

  async getOnboardingStatus(driverId: string) {
    const driver = await this.ensureDriver(driverId);
    const docs = await this.listDocuments(driverId);
    const bgCheck = await this.getBackgroundCheck(driverId);
    const banking = await db("driver_payout_accounts").where("driver_id", driverId).first();
    const agreements = await this.listAgreements(driverId);

    return {
      driver_id: driverId,
      status: driver.status,
      steps: {
        verification: { complete: driver.status !== "applicant" },
        documents: {
          complete: REQUIRED_DOC_TYPES.every((t) =>
            docs.some((d: any) => d.doc_type === t && d.status === "accepted"),
          ),
          items: docs,
        },
        background_check: {
          complete: bgCheck?.status === "passed",
          status: bgCheck?.status ?? "not_started",
        },
        banking: {
          complete: banking?.payouts_enabled ?? false,
          status: banking?.account_status ?? "not_started",
        },
        agreements: {
          contractor: agreements.some(
            (a: any) => a.agreement_type === "contractor_v1" && a.status === "signed",
          ),
          dpwra_disclosure: agreements.some(
            (a: any) => a.agreement_type === "dpwra_disclosure_v1" && a.status === "signed",
          ),
        },
      },
    };
  }

  // ─── Status transitions ──────────────────────────────────

  async transitionStatus(
    driverId: string,
    from: DriverOnboardingStatus,
    to: DriverOnboardingStatus,
  ) {
    if (!isValidTransition(from, to)) {
      throw new BadRequestError(`Invalid status transition: ${from} → ${to}`);
    }

    const [driver] = await db("drivers")
      .where("id", driverId)
      .where("status", from)
      .update({ status: to, updated_at: new Date() })
      .returning("*");

    if (!driver) {
      throw new BadRequestError(
        `Driver ${driverId} is not in status '${from}', cannot transition to '${to}'`,
      );
    }

    if (to === "active") {
      await db("drivers")
        .where("id", driverId)
        .update({ onboarding_completed_at: new Date() });
    }

    return driver;
  }

  async forceStatus(driverId: string, to: DriverOnboardingStatus) {
    const [driver] = await db("drivers")
      .where("id", driverId)
      .update({ status: to, updated_at: new Date() })
      .returning("*");
    if (!driver) throw new NotFoundError("Driver", driverId);
    return driver;
  }

  // ─── Helpers ─────────────────────────────────────────────

  private async ensureDriver(driverId: string) {
    const driver = await db("drivers").where("id", driverId).first();
    if (!driver) throw new NotFoundError("Driver", driverId);
    return driver;
  }

  private async tryAdvanceFromDocs(driverId: string) {
    const docs = await this.listDocuments(driverId);
    const allAccepted = REQUIRED_DOC_TYPES.every((t) =>
      docs.some((d: any) => d.doc_type === t && d.status === "accepted"),
    );
    if (allAccepted) {
      try {
        await this.transitionStatus(driverId, "docs_pending", "bg_check");
      } catch {
        // Already advanced or wrong state — ignore
      }
    }
  }

  private async tryAdvanceFromAgreements(driverId: string) {
    const agreements = await this.listAgreements(driverId);
    const hasCont = agreements.some(
      (a: any) => a.agreement_type === "contractor_v1" && a.status === "signed",
    );
    const hasDpwra = agreements.some(
      (a: any) => a.agreement_type === "dpwra_disclosure_v1" && a.status === "signed",
    );
    if (hasCont && hasDpwra) {
      try {
        await this.transitionStatus(driverId, "agreement", "active");
      } catch {
        // May need training step — ignore
      }
    }
  }
}

function mapVehicleType(input: string): string {
  const map: Record<string, string> = {
    car: "car",
    van: "van",
    reefer_van: "refrigerated_van",
    reefer_truck: "refrigerated_truck",
    pickup: "van", // closest match
  };
  return map[input] ?? "van";
}

export const driverOnboardingService = new DriverOnboardingService();
