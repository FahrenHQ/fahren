import Channel from "@/components/channel";

export default async function Component({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <Channel id={slug} />;
}
