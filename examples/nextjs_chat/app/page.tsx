"use client";
import useChannels from "@/hooks/useChannels";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const channels = useChannels();
  const router = useRouter();
  useEffect(() => {
    if (channels && channels.length > 0) {
      router.push(
        "/channel/" + channels?.find((x) => x.name === "General")?.id
      );
    }
  }, [channels]);

  return (
    <>
      <h1 className="text-xl font-black">Loading default channel</h1>
    </>
  );
}
