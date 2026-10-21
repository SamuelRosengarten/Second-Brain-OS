import { route } from "@/lib/api";
import { AcceptInput, acceptCapture } from "@/lib/captures";

export const dynamic = "force-dynamic";
export const POST = route({ body: AcceptInput }, ({ params, body }) => acceptCapture(params.id, body));
