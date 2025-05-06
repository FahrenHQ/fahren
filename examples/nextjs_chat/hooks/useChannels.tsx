"use client";
import { getChannels } from "@/app/actions";
import { useAuth } from "../contexts/auth";
import { useEffect, useState } from "react";

const useChannels = (): Array<{ id: string; name: string }> | undefined => {
  const [channels, setChannels] = useState<
    Array<{ id: string; name: string }> | undefined
  >();
  const { auth } = useAuth();

  useEffect(() => {
    const fetchChannel = async () => {
      try {
        if (auth) {
          const channels = await getChannels(auth);
          setChannels(channels);
        } else {
          setChannels([]);
        }
      } catch (error) {
        console.error("Error fetching channel:", error);
      }
    };

    fetchChannel();
  }, [auth]);

  return channels;
};

export default useChannels;
