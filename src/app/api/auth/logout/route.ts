import { json, route } from "@/lib/api";
import { sessionCookie } from "@/lib/auth";

export const POST = route({ public: true }, () => json({ ok: true }, 200, { "set-cookie": sessionCookie("", true) }));
