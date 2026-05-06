import assert from "node:assert/strict";
import test from "node:test";
import { validateProfileName } from "../src/validation.js";

test("validates safe profile names", () => {
  for (const name of ["work", "personal_1", "test.profile", "a-b_c.1"]) {
    assert.equal(validateProfileName(name), name);
  }
});

test("rejects unsafe profile names", () => {
  for (const name of ["", ".", "..", "../x", "x/y", "x\\y", "name with spaces", "a".repeat(65)]) {
    assert.throws(() => validateProfileName(name), /Invalid profile name/);
  }
});
