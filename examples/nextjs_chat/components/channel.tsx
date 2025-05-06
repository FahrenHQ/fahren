"use client";
import { sendMessage } from "@/app/actions";
import { MouseEventHandler, useCallback, useRef } from "react";
import { useAuth } from "../contexts/auth";
import useChannel from "../hooks/useChannel";
import Avatar from "./avatar";
import { mapUserIdToUri, mapUserIdToName } from "@/app/data";

const Channel = ({ id: channelId }: { id: string }) => {
  const { channel, refetch } = useChannel(channelId);
  const { messages, name } = channel;
  const { auth } = useAuth();
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const onClick: MouseEventHandler<HTMLButtonElement> =
    useCallback(async () => {
      if (textAreaRef.current && auth) {
        const content = textAreaRef.current.value.trim();
        textAreaRef.current.value = "";
        if (content) {
          await sendMessage(auth, channelId, content);
          await refetch();
        }
      }
    }, [channelId, auth]);

  console.log("MEssage: ", messages);
  console.log("Auth: ", auth);

  return (
    <>
      <h1 className="mb-2 text-2xl font-black">{name}</h1>
      <div className="ml-6">
        <div className="space-y-6">
          {messages.map((message) => (
            <div key={message.id} className="relative flex gap-x-4">
              <Avatar
                uri={mapUserIdToUri(message.userId)}
                name={mapUserIdToName(message.userId).substring(0, 1)}
                className="relative z-10 mt-3 size-6 bg-gray-100"
              />
              <div className="flex-auto rounded-md p-3 ring-1 ring-gray-200 ring-inset">
                <div className="flex justify-between gap-x-4">
                  <div className="py-0.5 text-xs/5 font-medium">
                    {mapUserIdToName(message.userId)}
                  </div>
                </div>
                <p className="text-sm/6 text-gray-500">{message.content}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex gap-x-3">
          <Avatar
            uri={auth?.user.avatarUri}
            name={auth?.user.name}
            className="size-7 bg-gray-100"
          />
          <div className="relative flex-auto">
            <div className="overflow-hidden rounded-lg pb-12 outline-1 -outline-offset-1 outline-gray-300 focus-within:outline-2">
              <label htmlFor="comment" className="sr-only">
                Jot your comment
              </label>
              <textarea
                ref={textAreaRef}
                id="comment"
                name="comment"
                rows={2}
                placeholder="Jot your comment..."
                className="block w-full resize-none bg-transparent px-3 py-1.5 text-base text-gray-900 placeholder:text-gray-400 focus:outline-none sm:text-sm/6"
                defaultValue={""}
              />
            </div>

            <div className="absolute inset-x-0 bottom-0 flex justify-between py-2 pr-2 pl-3">
              <div></div>
              <button
                type="submit"
                className="rounded-md bg-white px-2.5 py-1.5 text-sm font-semibold text-gray-900 shadow-xs ring-1 ring-gray-300 ring-inset hover:bg-gray-50"
                onClick={onClick}
              >
                Comment
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Channel;
