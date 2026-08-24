export interface Capability {
  id: string;
  provider: string;
  name: string;
  risk: "low" | "medium" | "high";
}
