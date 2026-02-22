import { db } from "../../db/index.js";
import { NotFoundError } from "../../shared/utils/errors.js";
import type { Customer, CustomerLocation } from "../../shared/types/index.js";
import type { CreateCustomerInput, CreateLocationInput } from "./customer.validation.js";

export class CustomerService {
  async list(page: number, perPage: number, offset: number) {
    const [customers, [{ count }]] = await Promise.all([
      db("customers").where("is_active", true).orderBy("name").limit(perPage).offset(offset),
      db("customers").where("is_active", true).count("id as count"),
    ]);
    return { customers, total: Number(count) };
  }

  async getById(id: string): Promise<Customer> {
    const customer = await db("customers").where("id", id).first();
    if (!customer) throw new NotFoundError("Customer", id);
    return customer;
  }

  async create(input: CreateCustomerInput): Promise<Customer> {
    const [customer] = await db("customers").insert(input).returning("*");
    return customer;
  }

  async update(id: string, updates: Partial<CreateCustomerInput>): Promise<Customer> {
    const [customer] = await db("customers")
      .where("id", id)
      .update({ ...updates, updated_at: new Date() })
      .returning("*");
    if (!customer) throw new NotFoundError("Customer", id);
    return customer;
  }

  // ─── Locations ──────────────────────────────────────────

  async listLocations(customerId: string) {
    return db("customer_locations").where({ customer_id: customerId, is_active: true }).orderBy("label");
  }

  async createLocation(customerId: string, input: CreateLocationInput): Promise<CustomerLocation> {
    await this.getById(customerId); // ensure exists
    const [loc] = await db("customer_locations")
      .insert({ ...input, customer_id: customerId })
      .returning("*");
    return loc;
  }

  async updateLocation(locationId: string, updates: Partial<CreateLocationInput>): Promise<CustomerLocation> {
    const [loc] = await db("customer_locations")
      .where("id", locationId)
      .update({ ...updates, updated_at: new Date() })
      .returning("*");
    if (!loc) throw new NotFoundError("CustomerLocation", locationId);
    return loc;
  }

  // ─── Catalog ────────────────────────────────────────────

  async getCatalog(customerId: string) {
    return db("customer_catalog")
      .join("products", "products.id", "customer_catalog.product_id")
      .where({ "customer_catalog.customer_id": customerId, "customer_catalog.is_active": true })
      .select("products.*", "customer_catalog.price");
  }
}

export const customerService = new CustomerService();
