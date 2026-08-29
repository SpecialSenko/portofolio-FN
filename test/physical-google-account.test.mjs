import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hashPhysicalPassword } from "../api/_lib/physical-password.js";
import {
  createPhysicalAccount,
  getOrCreateGooglePhysicalAccount,
  getPhysicalAccountById,
  PhysicalGoogleAccountConflictError,
} from "../api/_lib/physical-store.js";

test("verified Google identity links by email and remains stable by sub", async () => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "fraxb-google-account-"));
  const original = {
    nodeEnv: process.env.NODE_ENV,
    dataFile: process.env.PHYSICAL_MARKETPLACE_DATA_FILE,
    disabled: process.env.MARKETPLACE_STORAGE_DISABLED,
    kvUrl: process.env.KV_REST_API_URL,
    kvToken: process.env.KV_REST_API_TOKEN,
  };
  process.env.NODE_ENV = "development";
  process.env.PHYSICAL_MARKETPLACE_DATA_FILE = path.join(temporaryDirectory, "physical.json");
  delete process.env.MARKETPLACE_STORAGE_DISABLED;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  try {
    const passwordAccount = await createPhysicalAccount({
      email: "seller@example.com",
      passwordHash: await hashPhysicalPassword("correct horse battery staple"),
      displayName: "Seller",
      storeName: "Seller Store",
      city: "Jakarta",
    });
    const linked = await getOrCreateGooglePhysicalAccount({
      sub: "109876543210987654321",
      email: "seller@example.com",
      name: "Google Seller",
      authoritativeEmail: true,
    });
    assert.equal(linked.id, passwordAccount.id);
    assert.equal(linked.signInMethod, "google");
    assert.equal("googleSub" in linked, false);

    const renamedEmail = await getOrCreateGooglePhysicalAccount({
      sub: "109876543210987654321",
      email: "new-email@example.com",
      name: "Renamed Google Seller",
      authoritativeEmail: true,
    });
    assert.equal(renamedEmail.id, passwordAccount.id);
    assert.equal((await getPhysicalAccountById(passwordAccount.id)).storeName, "Seller Store");

    await createPhysicalAccount({
      email: "external@example.com",
      passwordHash: await hashPhysicalPassword("another correct horse battery staple"),
      displayName: "External Seller",
      storeName: "External Store",
      city: "Bandung",
    });
    await assert.rejects(
      getOrCreateGooglePhysicalAccount({
        sub: "109876543210987654322",
        email: "external@example.com",
        name: "External Seller",
        authoritativeEmail: false,
      }),
      PhysicalGoogleAccountConflictError,
    );
  } finally {
    if (original.nodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = original.nodeEnv;
    if (original.dataFile === undefined) delete process.env.PHYSICAL_MARKETPLACE_DATA_FILE; else process.env.PHYSICAL_MARKETPLACE_DATA_FILE = original.dataFile;
    if (original.disabled === undefined) delete process.env.MARKETPLACE_STORAGE_DISABLED; else process.env.MARKETPLACE_STORAGE_DISABLED = original.disabled;
    if (original.kvUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = original.kvUrl;
    if (original.kvToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = original.kvToken;
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
});
