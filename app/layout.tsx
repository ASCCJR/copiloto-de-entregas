import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/inter";
import "./styles.css";

export const metadata: Metadata = {
  title: "Copiloto de Entregas | Antonio Sergio",
  description: "Explore a pontualidade do e-commerce brasileiro com pedidos históricos da Olist.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
