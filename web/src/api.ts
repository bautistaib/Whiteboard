/** REST helpers. */

export async function createCampaign(name: string): Promise<{ dm_url: string; player_url: string }> {
  const resp = await fetch("/api/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!resp.ok) throw new Error("no se pudo crear la campaña");
  return resp.json();
}

export interface CampaignSummary {
  id: string;
  name: string;
  dm_url: string;
  player_url: string;
  created_at: number;
}

export async function listCampaigns(): Promise<CampaignSummary[]> {
  const resp = await fetch("/api/campaigns");
  if (!resp.ok) throw new Error("no se pudieron listar las campañas");
  return resp.json();
}

export async function getSettings(): Promise<{ defaultGrid: Record<string, any> }> {
  const resp = await fetch("/api/settings");
  if (!resp.ok) throw new Error("error");
  return resp.json();
}

export async function saveSettings(defaultGrid: Record<string, any>): Promise<void> {
  const resp = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ defaultGrid }),
  });
  if (!resp.ok) throw new Error("no se pudo guardar la configuración");
}

export async function sessionInfo(token: string): Promise<{ role: "dm" | "player"; campaignName: string }> {
  const resp = await fetch(`/api/session/${token}`);
  if (!resp.ok) throw new Error("link inválido");
  return resp.json();
}

export async function uploadImage(
  token: string,
  file: File | Blob,
  opts: {
    kind: "token" | "map" | "other";
    name: string;
    characterId?: string;
    variantLabel?: string;
    sizeCells?: number;
    filename?: string;
  },
): Promise<{ id: string; filename: string; characterId: string; variantId: string }> {
  const params = new URLSearchParams({
    kind: opts.kind,
    name: opts.name,
    characterId: opts.characterId ?? "",
    variantLabel: opts.variantLabel ?? "",
    sizeCells: String(opts.sizeCells ?? 1),
  });
  const form = new FormData();
  form.append("file", file, opts.filename ?? "imagen.png");
  const resp = await fetch(`/api/upload/${token}?${params}`, { method: "POST", body: form });
  if (!resp.ok) {
    const detail = (await resp.json().catch(() => null))?.detail;
    throw new Error(detail ?? "error subiendo la imagen");
  }
  return resp.json();
}

export async function addVariant(
  token: string,
  characterId: string,
  assetId: string,
  label: string,
  sizeCells: number,
): Promise<void> {
  const params = new URLSearchParams({ assetId, label, sizeCells: String(sizeCells) });
  const resp = await fetch(`/api/characters/${token}/${characterId}/variants?${params}`, {
    method: "POST",
  });
  if (!resp.ok) throw new Error("no se pudo agregar la variante");
}

export async function deleteAsset(token: string, assetId: string, name: string): Promise<void> {
  const params = new URLSearchParams({ name });
  const resp = await fetch(`/api/assets/${token}/${assetId}?${params}`, { method: "DELETE" });
  if (!resp.ok) throw new Error("no se pudo borrar el asset");
}

export async function tunnelInfo(token: string): Promise<{ url: string | null; player_url: string | null }> {
  const resp = await fetch(`/api/tunnel/${token}`);
  if (!resp.ok) throw new Error("error");
  return resp.json();
}
