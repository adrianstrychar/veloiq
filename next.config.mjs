/** @type {import('next').NextConfig} */
const nextConfig = {
  // ESLint: warnings stylu (any/const/unused) nadal wyciszone przy buildzie — osobny dług, osobny PR.
  eslint: { ignoreDuringBuilds: true },
  // TypeScript: type-check ZNÓW blokuje build. Cały dług TS naprawiony (Calendar Map→Array.from,
  // overload-correction change, szum lokalny wykluczony w tsconfig), tsc --noEmit czysty. Od teraz
  // błąd typu ZATRZYMUJE build/deploy — nie przejdzie cicho (jak overload-correction z #95).
};

export default nextConfig;
