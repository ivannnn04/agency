import { redirect } from "next/navigation";

export default async function PMProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/pm/projects/${id}/tasks`);
}
