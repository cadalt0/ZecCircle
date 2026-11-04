import { Benefits } from "@/components/Benefits";
import { Bitrefill } from "@/components/Bitrefill";
import { BitrefillStore } from "@/components/BitrefillStore";
import { ChatShowcase } from "@/components/ChatShowcase";
import { FAQ, FinalCTA, Footer } from "@/components/Closing";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { Marquee } from "@/components/Marquee";
import { Nav } from "@/components/Nav";
import { Privacy } from "@/components/Privacy";
import { UseCases } from "@/components/UseCases";

export default function Home() {
  return (
    <main className="relative">
      <Nav />
      <Hero />
      <Marquee />
      <HowItWorks />
      <Benefits />
      <Bitrefill />
      <BitrefillStore />
      <ChatShowcase />
      <UseCases />
      <Privacy />
      <FAQ />
      <FinalCTA />
      <Footer />
    </main>
  );
}
