"use client";
import { Channel, getChannelById } from "@/app/actions";
import { useAuth } from "../contexts/auth";
import { useCallback, useEffect, useState } from "react";

const useChannel = (id: string) => {
  const [channel, setChannel] = useState<Channel>({ messages: [], name: "" });
  const { auth } = useAuth();

  const fetchChannel = useCallback(async (id: string) => {
    try {
      if (auth) {
        const channel = await getChannelById(auth, id);
        setChannel(channel);
      }
    } catch (error) {
      console.error("Error fetching channel:", error);
    }
  }, []);

  useEffect(() => {
    fetchChannel(id);
  }, [id]);

  const refetch = useCallback(() => {
    fetchChannel(id);
  }, [id]);

  return { channel, refetch };
};

export default useChannel;
