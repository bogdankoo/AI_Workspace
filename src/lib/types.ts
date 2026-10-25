export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  createdAt: number;
}

export interface Workspace {
  id: string;
  name: string;
  messages: Message[];
}
