"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function LandingPage() {
  const toggleTheme = () => {
      document.documentElement.classList.toggle('darkmode-invert');
      const isDark = document.documentElement.classList.contains('darkmode-invert');
      localStorage.setItem('confpay_theme', isDark ? 'dark' : 'light');
  };

  useEffect(() => {
      const stored = localStorage.getItem('confpay_theme');
      if (stored === 'dark') {
          document.documentElement.classList.add('darkmode-invert');
      }
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 relative">
      {/* Theme Toggle */}
      <div className="absolute top-6 right-6 z-50">
          <button
            onClick={toggleTheme}
            className="p-3 rounded-full bg-gray-100 hover:bg-gray-200 transition-all shadow-md hover:scale-110 active:scale-95"
            title="Toggle Theme"
          >
            🌓
          </button>
      </div>

      <div className="max-w-4xl w-full text-center space-y-8 animate-fade-in">
        {/* Logo Section */}
        <div className="flex justify-center mb-8 animate-scale-in">
          <div className="relative">
            <div className="absolute inset-0 bg-blue-500 rounded-full blur-2xl opacity-20 animate-pulse"></div>
            <Link href="/">
              <img
                src="/logo.png"
                alt="ConfPay Logo"
                className="w-32 h-32 object-contain logo-blend relative z-10 cursor-pointer hover:scale-105 transition-transform duration-300 logo-light"
              />
              <img
                src="/logo2.png"
                alt="ConfPay Logo"
                className="w-32 h-32 object-contain relative z-10 cursor-pointer hover:scale-105 transition-transform duration-300 logo-dark"
              />
            </Link>
          </div>
        </div>

        <div className="space-y-4 animate-slide-up animate-delay-100">
          <h1 className="logo-title text-5xl md:text-6xl font-extrabold text-gradient mb-4">
            CONFPAY
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
            The privacy-first payroll system built on{" "}
            <span className="text-blue-600 font-semibold">Solana</span>.
            <br />
            Salaries are encrypted client-side.{" "}
            <span className="font-medium text-gray-800">
              Only you control the data.
            </span>
          </p>
        </div>

        {/* CTA Cards */}
        <div className="grid md:grid-cols-2 gap-8 mt-16 animate-slide-up animate-delay-200">
          {/* Employer Card */}
          <div className="card group hover:border-blue-200">
            <div className="text-5xl mb-6 group-hover:scale-110 transition-transform duration-300">
              🏢
            </div>
            <h2 className="text-2xl font-bold mb-3 text-gray-900">
              Employer Portal
            </h2>
            <p className="text-gray-600 mb-8 leading-relaxed">
              Create company payroll, add employees securely, and manage
              payments with full confidentiality.
            </p>
            <Link href="/employer" className="block w-full">
              <button className="btn-primary w-full shadow-lg shadow-cyan-500/20">
                Enter as Employer
              </button>
            </Link>
          </div>

          {/* Worker Card */}
          <div className="card group hover:border-blue-200">
            <div className="text-5xl mb-6 group-hover:scale-110 transition-transform duration-300">
              👷
            </div>
            <h2 className="text-2xl font-bold mb-3 text-gray-900">
              Worker Portal
            </h2>
            <p className="text-gray-600 mb-8 leading-relaxed">
              Access your payslips, verify payments, and manage your credentials
              using your secure PIN.
            </p>
            <Link href="/worker" className="block w-full">
              <button className="btn-secondary w-full">Enter as Worker</button>
            </Link>
          </div>
        </div>

        {/* Footer / Trust Signals */}
        <div className="mt-20 pt-8 border-t border-gray-100 animate-slide-up animate-delay-300">
          <p className="text-sm text-gray-400 font-medium">
            Powered by Solana & Inco Network • End-to-End Encryption
          </p>
          <div className="mt-4 mb-6">
            <a
              href="https://x.com/0xVincentee"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block btn-secondary"
            >
              CONTACT&nbsp;US
            </a>
          </div>

          {/* Live Status Indicator */}
          <div className="flex items-center justify-center gap-2 mt-8 animate-pulse">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
              <span className="text-sm font-semibold text-green-600 tracking-wide uppercase">
                  Live on Solana Devnet
              </span>
          </div>
        </div>
      </div>
    </main>
  );
}
