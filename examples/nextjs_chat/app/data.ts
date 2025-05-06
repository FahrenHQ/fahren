export function mapUserIdToName(id: string) {
  return users.find((x) => x.id === id)?.name || id;
}

export function mapUserIdToUri(id: string) {
  return users.find((x) => x.id === id)?.avatarUri;
}

export interface Tenant {
  id: string;
  name: string;
}

export const tenants: Array<Tenant> = [
  { id: "5d4cb3b2-29cc-43e4-952d-b9cb3816ae2f", name: "Wisdom Co." },
  { id: "208de300-7cd1-4aa4-a2aa-4dafa4e303dd", name: "Ausbury Inc." },
];

export interface User {
  id: string;
  name: string;
  avatarUri: string;
  tenants: Array<Tenant>;
}

export const users: Array<User> = [
  {
    id: "0dff7c44-de06-4ab5-a6ce-3c0a72bc7e21",
    name: "Jack",
    avatarUri: "/uifaces-1.jpg",
    tenants,
  },
  {
    id: "81846e10-109a-4baa-861a-f7cbcb2e545f",
    name: "Ronny",
    avatarUri: "/uifaces-2.jpg",
    tenants: [
      { id: "208de300-7cd1-4aa4-a2aa-4dafa4e303dd", name: "Ausbury Inc." },
    ],
  },
  {
    id: "fea1a37b-6827-408f-9be8-d878f2fa872f",
    name: "Samanta",
    avatarUri: "/uifaces-3.jpg",
    tenants: [
      { id: "5d4cb3b2-29cc-43e4-952d-b9cb3816ae2f", name: "Wisdom Co." },
    ],
  },
];
