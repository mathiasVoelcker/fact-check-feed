import { getDb } from "../../../src/db/client";
import { handleClaimsRequest } from "../../../src/feed/claims-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleClaimsRequest(getDb(), new URL(request.url));
}
