"use client";
import React, { PropsWithChildren } from "react";
import Avatar from "./avatar";
import { useAuth } from "@/contexts/auth";
import useChannels from "@/hooks/useChannels";
import { useRouter } from "next/navigation";
import Select from "./select";

const Layout = ({ children }: PropsWithChildren) => {
  const { auth, setAuth } = useAuth();
  const channels = useChannels();
  const router = useRouter();

  return (
    <div className="relative flex min-h-svh w-full bg-white max-lg:flex-col lg:bg-zinc-100">
      {auth && (
        <div className="fixed left-0 w-64">
          <nav className="flex flex-col h-full min-h-0">
            <div className="flex flex-col border-b border-gray-200 p-4">
              <Select
                options={auth.user.tenants.map((tenant) => ({
                  label: tenant.name,
                  value: tenant.id,
                }))}
                value={auth.tenant.id}
                onChange={(value) => {
                  const tenant = auth.user.tenants.find((x) => x.id === value);
                  if (tenant) {
                    setAuth({
                      ...auth,
                      tenant,
                    });
                  }
                }}
              />
            </div>
            <div className="flex flex-1 flex-col overflow-y-auto p-4 grow">
              <p className="text-sm text-gray-400">Channels</p>
              {channels?.map((x) => (
                <div
                  key={x.id}
                  onClick={() => {
                    router.push("/channel/" + x.id);
                  }}
                  className="flex gap-1 items-center py-2 text-zinc-900 sm:py-2 sm:text-sm/5  w-full rounded px-4 hover:bg-gray-200 hover:text-gray-600 hover:cursor-pointer"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2.5}
                    stroke="currentColor"
                    className="size-3"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5-3.9 19.5m-2.1-19.5-3.9 19.5"
                    />
                  </svg>
                  {x.name}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 text-zinc-950 border-t border-gray-200 p-4">
              <Avatar
                uri={auth.user.avatarUri}
                name={auth.user.name}
                size={30}
              />
              {auth.user.name}
              <button
                onClick={() => setAuth(undefined)}
                className="text-xs border border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-600 rounded p-1 py-0.5 ml-auto hover:cursor-pointer"
              >
                Logout
              </button>
            </div>
          </nav>
        </div>
      )}

      <main
        className={`flex flex-1 flex-col p-2 min-w-0 ${auth ? " pl-64" : ""}`}
      >
        <div className="grow ring-gray-200 rounded-lg bg-white p-10 ring-1 shadow-xs">
          <div className="mx-auto max-w-6xl">{children}</div>
        </div>
      </main>
    </div>
  );
};

export default Layout;
