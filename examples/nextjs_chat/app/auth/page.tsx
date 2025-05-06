"use client";
import Avatar from "@/components/avatar";
import { useAuth } from "@/contexts/auth";
import { useRouter } from "next/navigation";
import { users } from "../data";

const AuthPage = () => {
  const { setAuth } = useAuth();
  const router = useRouter();

  return (
    <div style={{ padding: "20px" }}>
      <h1 className="text-4xl font-black">Impersonate User</h1>
      <p className="mt-2">
        Select a user to log in and impersonate them, viewing their associated
        workspaces (tenants) and channels.
      </p>

      <div className="mt-10 grid w-fit grid-cols-3 grid-rows-1 gap-x-30 gap-y-10">
        {users.map((user) => (
          <div
            className="w-64 rounded-lg border border-gray-100 hover:border-gray-300 p-4 hover:cursor-pointer"
            onClick={() => {
              setAuth({
                user,
                tenant: user.tenants[0],
              });
              router.push("/");
            }}
            key={user.id}
          >
            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-medium">{user.name}</h2>
              </div>

              <p className="mt-4 mb-2 text-sm text-gray-400">Workspaces</p>
              <div className="flex flex-row gap-2">
                {user.tenants.map((x) => (
                  <Avatar
                    key={x.id + user.id}
                    name={x.name.substring(0, 1)}
                    className="size-7 bg-gray-100"
                  />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AuthPage;
