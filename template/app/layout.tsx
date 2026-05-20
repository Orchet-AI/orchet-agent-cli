import type { ReactNode } from "react";

export const metadata = {
  title: "{{DISPLAY_NAME}} for Orchet",
  description: "{{ONE_LINER}}",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
