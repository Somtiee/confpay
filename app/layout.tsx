import "./globals.css";
import { Providers } from "./providers";

export const metadata = {
  title: "ConfPay",
  description: "Confidential Payroll on Solana using Inco Lightning",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var saved = localStorage.getItem("confpay_darkmode");
                  if (saved === "1") {
                    document.documentElement.classList.add("darkmode-invert");
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
