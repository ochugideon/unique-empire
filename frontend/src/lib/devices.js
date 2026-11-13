const KEY = "ue_device_id";

export function getDeviceId() {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = "ue-" + crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}
