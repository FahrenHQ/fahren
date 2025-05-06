"use client";

import { User, Tenant } from "@/app/data";
import { useRouter } from "next/navigation";
import {
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useState,
} from "react";

export interface Auth {
  user: User;
  tenant: Tenant;
}

interface AuthContextType {
  auth: Auth | undefined;
  setAuth: (auth: Auth | undefined) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [auth, setAuth] = useState<Auth>();
  const [loading, setLoading] = useState<boolean>(true);
  const router = useRouter();

  useEffect(() => {
    if (!auth) {
      router.push("/auth");
    } else {
      router.push("/");
    }
    setLoading(false);
  }, [auth]);

  return (
    <AuthContext.Provider value={{ auth, setAuth }}>
      {loading ? <></> : children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within a AuthProvider");
  }
  return context;
};
