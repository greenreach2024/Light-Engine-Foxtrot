import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import express from "express";
import buyerRouter from "../server/buyer/routes.js";
import {
  resetShares,
  getShareByToken,
} from "../server/buyer/data.js";

async function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use(buyerRouter);

  const server = http.createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test("GET /shared/homes/:homeId enforces share grant", async () => {
  await resetShares();
  const server = await createTestServer();

  try {
    const forbidden = await fetch(`${server.baseUrl}/shared/homes/home-001`);
    assert.equal(forbidden.status, 403);
    const errorBody = await forbidden.json();
    assert.equal(errorBody.error, "NO_SHARE");

    const allowed = await fetch(`${server.baseUrl}/shared/homes/home-001`, {
      headers: { "x-share-token": "share-abc-123" },
    });
    assert.equal(allowed.status, 200);
    const payload = await allowed.json();
    assert.equal(payload.home.sharePolicy, "Owners choose if/what to share.");
    assert.equal(payload.home.address.masked, true);
    assert.equal(payload.home.photosAvailable, false);
  } finally {
    await server.close();
  }
});

test("Shared home respects scope for address and photos", async () => {
  await resetShares();
  const server = await createTestServer();

  try {
    const response = await fetch(`${server.baseUrl}/shared/homes/home-001`, {
      headers: { "x-share-token": "share-extended-001" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.home.address.line1);
    assert.ok(Array.isArray(body.home.photos));
    assert.equal(body.home.photos[0].alt.includes("Living room"), true);
  } finally {
    await server.close();
  }
});

test("Revocation removes access to shared home", async () => {
  await resetShares();
  const server = await createTestServer();

  try {
    const first = await fetch(`${server.baseUrl}/shared/homes/home-001`, {
      headers: { "x-share-token": "share-abc-123" },
    });
    assert.equal(first.status, 200);

    const revokeResponse = await fetch(`${server.baseUrl}/home-shares/share-abc-123/revoke`, {
      method: "POST",
    });
    assert.equal(revokeResponse.status, 204);
    assert.equal(getShareByToken("share-abc-123"), null);

    const afterRevocation = await fetch(`${server.baseUrl}/shared/homes/home-001`, {
      headers: { "x-share-token": "share-abc-123" },
    });
    assert.equal(afterRevocation.status, 403);
    const errorBody = await afterRevocation.json();
    assert.equal(errorBody.error, "NO_SHARE");
  } finally {
    await server.close();
  }
});

test("Wishlist snapshot returns aggregate values only", async () => {
  await resetShares();
  const server = await createTestServer();

  try {
    const snapshotResponse = await fetch(`${server.baseUrl}/wishlists/wishlist-001/supply-snapshot`);
    assert.equal(snapshotResponse.status, 200);
    const snapshot = await snapshotResponse.json();
    assert.equal(snapshot.matchingHomes.label, "Matching homes (owners): count only");
    assert.equal("homes" in snapshot, false);
    assert.equal(Array.isArray(snapshot.matchingHomes), false);
  } finally {
    await server.close();
  }
});
