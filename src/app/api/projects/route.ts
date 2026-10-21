import { route } from "@/lib/api";
import { createProject, listProjects, ProjectInput } from "@/lib/projects";

export const dynamic = "force-dynamic";
export const GET = route({}, ({ url }) => ({ projects: listProjects(url.searchParams.get("status") || undefined) }));
export const POST = route({ body: ProjectInput }, ({ body }) => ({ project: createProject(body) }));
