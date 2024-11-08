import { getProject } from "@/api/projects";
import { notFound, redirect } from "next/navigation";

export default async function Page(props: {
  params: Promise<{
    team_slug: string;
    project_slug: string;
  }>;
}) {
  const params = await props.params;
  const project = await getProject(params.team_slug, params.project_slug);

  if (!project) {
    notFound();
  }

  redirect(
    `/team/${params.team_slug}/${params.project_slug}/connect/in-app-wallets`,
  );
}
