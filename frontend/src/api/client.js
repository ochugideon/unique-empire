import { getDeviceId } from "@/lib/device";

let accessToken = null;
export const setAccessToken = (token) => {
  accessToken = token;
};

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api(path, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Id": getDeviceId(),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "ERROR",
      err?.message ?? "Something went wrong. Please try again.",
      err?.details,
    );
  }
  return data;
}
