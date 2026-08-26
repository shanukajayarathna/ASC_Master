import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ASC Intelligent Hub — Ceylon Tea Auction Intelligence",
  description:
    "AI-powered valuation, document, and market intelligence for the Colombo tea auction — built for brokers, estates, and buyers.",
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
