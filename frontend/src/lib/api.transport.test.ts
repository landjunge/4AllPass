import "./test-storage-shim.ts";

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifySidecarRequestError,
  classifySidecarTransportRejection,
} from "./api.ts";
import { isOfflineError, OfflineTransportError } from "./snapshot-cache.ts";

test("only the three typed local transport codes become offline", () => {
  for (const code of ["offline_network", "offline_timeout", "offline_io"] as const) {
    const error = classifySidecarTransportRejection({ code, message: "synthetic" });
    assert.ok(error instanceof OfflineTransportError);
    assert.equal(error?.code, code);
    assert.equal(isOfflineError(error), true);
    assert.equal(error?.message, "desktop sidecar transport unavailable");
  }
});

test("validation, protocol, capability and internal stay non-offline", () => {
  for (const code of ["validation", "protocol", "capability", "internal"] as const) {
    assert.equal(classifySidecarTransportRejection({ code }), null);
    const error = classifySidecarRequestError({ code });
    assert.equal(error.code, code);
    assert.equal(isOfflineError(error), false);
  }
});

test("browser fetch TypeError stays offline; strings and plain errors do not", () => {
  assert.equal(isOfflineError(new TypeError("synthetic fetch failure")), true);
  assert.equal(isOfflineError(new Error("synthetic product error")), false);
  assert.equal(isOfflineError("synthetic string rejection"), false);
  assert.equal(classifySidecarTransportRejection("synthetic string rejection"), null);
  assert.equal(classifySidecarRequestError("synthetic string rejection").code, "capability");
});

test("malformed error objects never become offline", () => {
  for (const value of [null, undefined, {}, { code: 42 }, { code: "offline_unknown" }]) {
    assert.equal(classifySidecarTransportRejection(value), null);
    assert.equal(classifySidecarRequestError(value).code, "capability");
  }
});

test("HTTP status results are not offline errors", () => {
  // 401/403/409/422 are SidecarHttpResult values, not Error objects.
  assert.equal(isOfflineError({ status: 401 }), false);
  assert.equal(isOfflineError({ status: 403 }), false);
  assert.equal(isOfflineError({ status: 409 }), false);
  assert.equal(isOfflineError({ status: 422 }), false);
});
