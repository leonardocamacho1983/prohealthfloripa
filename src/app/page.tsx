import { getImageProps } from "next/image";
import Image from "next/image";

import { HomeIntro } from "./home-intro";
import styles from "./home.module.css";

const whatsappUrl =
  "https://wa.me/5548998621948?text=Ol%C3%A1%2C%20quero%20conhecer%20a%20ProHealth.";
const plansUrl =
  "https://venda.nextfit.com.br/afda9e7e-af58-4b0f-b882-4be65b5a0bdd/contratos";
const directionsUrl =
  "https://www.google.com/maps/search/?api=1&query=Rua+Vera+Linhares+de+Andrade%2C+2063%2C+C%C3%B3rrego+Grande%2C+Florian%C3%B3polis";

function ArrowIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" /></svg>;
}

function Brand() {
  return <span className={styles.brand} aria-label="ProHealth Saúde e Performance">
    <strong>PRO HEALTH</strong><small>SAÚDE E PERFORMANCE</small>
  </span>;
}

function HeroPicture() {
  const common = {
    alt: "Mulher realizando um movimento controlado de Pilates no estúdio ProHealth",
    sizes: "100vw",
  };
  const { props: { srcSet: desktop } } = getImageProps({
    ...common,
    src: "/images/generated/prohealth-hero-human-performance-desktop-v1.png",
    width: 1672,
    height: 941,
    quality: 88,
  });
  const { props: { srcSet: mobile, ...rest } } = getImageProps({
    ...common,
    src: "/images/generated/prohealth-hero-human-performance-mobile-v1.png",
    width: 941,
    height: 1672,
    quality: 82,
  });
  return <picture className={styles.heroPicture}>
    <source media="(min-width: 760px)" srcSet={desktop} />
    <source media="(max-width: 759px)" srcSet={mobile} />
    <img {...rest} alt={common.alt} fetchPriority="high" />
  </picture>;
}

const serviceRows = [
  { number: "02", title: "Fisioterapia", copy: "Atendimento individual com duração total de uma hora.", href: "#cuidado" },
  { number: "03", title: "Recovery e termoterapias", copy: "Banheira de gelo, banho quente e contraste em atendimento individual.", href: "#recovery" },
  { number: "04", title: "Movimento e preparação física", copy: "Mobilidade, estabilidade e fortalecimento funcional para pessoas ativas.", href: "#abordagem" },
] as const;

const faqItems = [
  { question: "A aula experimental de Pilates é gratuita?", answer: "Sim. A ProHealth oferece gratuitamente a aula experimental de Pilates." },
  { question: "Quantas pessoas participam de uma aula de Pilates?", answer: "As agendas de Pilates são organizadas em grupos de até três pessoas." },
  { question: "Quanto tempo dura um atendimento?", answer: "Os atendimentos ocupam uma hora completa, incluindo todo o processo. A Massagem Express dura 30 minutos." },
  { question: "A ProHealth atende no fim de semana?", answer: "Sábados e domingos funcionam somente com agendamento prévio para clientes de planos, sem aula experimental ou serviço avulso." },
  { question: "Onde fica a ProHealth?", answer: "Na Rua Vera Linhares de Andrade, 2063, no Córrego Grande, em Florianópolis." },
  { question: "Como confirmar se a termoterapia é adequada para mim?", answer: "Se você tem uma condição médica, está gestante, passou por cirurgia recente ou tem qualquer dúvida de segurança, confirme previamente com a equipe ou com o profissional responsável." },
] as const;

export default function Home() {
  return <main className={styles.page}>
    <HomeIntro />

    <section className={styles.hero} aria-labelledby="hero-title">
      <HeroPicture />
      <div className={styles.heroFade} />
      <div className={styles.heroLine} aria-hidden="true" />

      <header className={styles.header}>
        <a className={styles.brandLink} href="#inicio"><Brand /></a>
        <nav className={styles.desktopNav} aria-label="Navegação principal">
          <a href="#servicos">Serviços</a><a href="#abordagem">Método</a>
          <a href="#espaco">Espaço</a><a href="#contato">Contato</a>
        </nav>
        <a className={styles.headerCta} href={whatsappUrl} target="_blank" rel="noreferrer">Falar com a ProHealth</a>
        <details className={styles.mobileMenu}>
          <summary aria-label="Abrir menu"><span /><span /></summary>
          <nav aria-label="Navegação móvel">
            <a href="#servicos">Serviços</a><a href="#abordagem">Método</a>
            <a href="#espaco">Espaço</a><a href="#contato">Contato</a>
          </nav>
        </details>
      </header>

      <div className={styles.heroContent} id="inicio">
        <p className={styles.eyebrow}>PRO HEALTH · FLORIANÓPOLIS</p>
        <h1 id="hero-title">Movimento, recuperação e performance. <span>No mesmo lugar.</span></h1>
        <p className={styles.heroDescription}>Pilates, fisioterapia, massagens, termoterapias e preparação física para atletas e pessoas ativas.</p>
        <div className={styles.heroActions}>
          <a className={styles.primaryButton} href={whatsappUrl} target="_blank" rel="noreferrer">Falar com a ProHealth <ArrowIcon /></a>
          <a className={styles.secondaryButton} href="#servicos">Conhecer os serviços <ArrowIcon /></a>
        </div>
        <p className={styles.heroProof}>Aula experimental de Pilates gratuita.</p>
      </div>
      <a className={styles.scrollCue} href="#servicos" aria-label="Ir para os serviços"><span /></a>
    </section>

    <section className={styles.services} id="servicos" aria-labelledby="services-title">
      <div className={styles.sectionHeading}>
        <div><p className={styles.sectionIndex}>01 — SERVIÇOS</p><h2 id="services-title">Escolha seu <span>caminho.</span></h2></div>
        <p>Um espaço, diferentes formas de cuidar do movimento e da sua rotina.</p>
      </div>
      <div className={styles.servicesGrid}>
        <a className={styles.mediaService} href="#pilates">
          <Image src="/images/generated/prohealth-pilates-human-secondary-nano-v1.png" alt="Mulher executando um movimento de Pilates no reformer" fill sizes="(max-width: 760px) 92vw, 31vw" quality={84} />
          <span className={styles.mediaShade} /><span className={styles.mediaLabel}>Pilates <ArrowIcon /></span>
        </a>
        <div className={styles.serviceList}>
          {serviceRows.map((service) => <a key={service.title} href={service.href} className={styles.serviceRow}>
            <span className={styles.serviceNumber}>{service.number}</span>
            <span><strong>{service.title}</strong><small>{service.copy}</small></span><ArrowIcon />
          </a>)}
        </div>
        <a className={styles.mediaService} href="#cuidado">
          <Image src="/images/generated/prohealth-therapy-human-closeup-nano-v1.png" alt="Mulher recebendo uma massagem profissional nos ombros" fill sizes="(max-width: 760px) 92vw, 31vw" quality={84} />
          <span className={styles.mediaShade} /><span className={styles.mediaLabel}>Massagens <ArrowIcon /></span>
        </a>
      </div>
    </section>

    <section className={styles.approach} id="abordagem" aria-labelledby="approach-title">
      <div className={styles.approachTop}>
        <div><p className={styles.sectionIndex}>02 — UMA PROPOSTA INTEGRADA</p><h2 id="approach-title">Corpo e movimento vistos como um <span>todo.</span></h2></div>
        <p>A ProHealth integra corpo, movimento, recuperação e performance sem transformar essa combinação em uma fórmula única.</p>
      </div>
      <div className={styles.approachRail}>
        {[["01", "Movimento"], ["02", "Cuidado"], ["03", "Recuperação"], ["04", "Performance"]].map(([number, label]) => <div key={label}><span>{number}</span><strong>{label}</strong></div>)}
      </div>
    </section>

    <section className={styles.featureLight} id="pilates" aria-labelledby="pilates-title">
      <div className={styles.featureCopy}>
        <p className={styles.sectionIndex}>PILATES</p><h2 id="pilates-title">Mais atenção em cada movimento.</h2>
        <p>Aulas em grupos de até três pessoas, com espaço e equipamentos preparados para uma prática acompanhada de perto.</p>
        <p className={styles.featureFact}>Sua primeira aula experimental é gratuita.</p>
        <a className={styles.darkButton} href={whatsappUrl} target="_blank" rel="noreferrer">Agendar aula experimental <ArrowIcon /></a>
      </div>
      <div className={styles.featureImageWide}>
        <Image src="/images/prohealth-space-pilates-wide-v1.jpeg" alt="Sala de Pilates da ProHealth com reformers e equipamentos" fill sizes="(max-width: 860px) 100vw, 60vw" quality={82} />
      </div>
    </section>

    <section className={styles.recovery} id="recovery" aria-labelledby="recovery-title">
      <div className={styles.recoveryCopy}>
        <p className={styles.sectionIndex}>RECOVERY E TERMOTERAPIAS</p><h2 id="recovery-title">Frio, calor e contraste em um ambiente de presença.</h2>
        <p>Banheira de gelo, banho quente e contraste são oferecidos em atendimento individual. A equipe orienta o fluxo antes da experiência.</p>
        <p className={styles.safetyNote}>Em caso de condição médica, gestação, cirurgia recente ou dúvida de segurança, confirme previamente com a equipe ou profissional responsável.</p>
        <a className={styles.lightButton} href={whatsappUrl} target="_blank" rel="noreferrer">Conversar com a equipe <ArrowIcon /></a>
      </div>
      <div className={styles.recoveryImage}>
        <Image src="/images/generated/prohealth-recovery-room-concept-v1.png" alt="Sala de termoterapia da ProHealth com banheira e ambientação azul e âmbar" fill sizes="(max-width: 860px) 100vw, 56vw" quality={86} />
      </div>
    </section>

    <section className={styles.care} id="cuidado" aria-labelledby="care-title">
      <div className={styles.careImage}><Image src="/images/generated/prohealth-therapy-human-closeup-nano-v1.png" alt="Atendimento profissional de massagem na ProHealth" fill sizes="(max-width: 860px) 100vw, 47vw" quality={84} /></div>
      <div className={styles.careCopy}>
        <p className={styles.sectionIndex}>MASSAGENS E FISIOTERAPIA</p><h2 id="care-title">Cuidado individual, com tempo para estar presente.</h2>
        <p>Massagens tradicionais e especiais, além do atendimento de fisioterapia, ocupam uma hora completa de cuidado e processo.</p>
        <ul><li>Atendimento de massagem individual</li><li>Técnicas tradicionais e especiais confirmadas pela equipe</li><li>Massagem Express com 30 minutos</li></ul>
        <a className={styles.textLink} href={whatsappUrl} target="_blank" rel="noreferrer">Encontrar o atendimento adequado <ArrowIcon /></a>
      </div>
    </section>

    <section className={styles.space} id="espaco" aria-labelledby="space-title">
      <div className={styles.spaceHeading}>
        <p className={styles.sectionIndex}>03 — O ESPAÇO</p><h2 id="space-title">Precisão, recuperação e <span>presença.</span></h2>
        <p>Ambientes reais da ProHealth no Córrego Grande, em Florianópolis.</p>
      </div>
      <div className={styles.spaceGallery}>
        <figure className={styles.galleryWide}><Image src="/images/prohealth-space-brand-wall-v1.jpeg" alt="Área de termoterapia da ProHealth com iluminação geométrica" fill sizes="(max-width: 760px) 100vw, 58vw" quality={80} /><figcaption><span>01</span> Recuperação</figcaption></figure>
        <figure className={styles.galleryTall}><Image src="/images/prohealth-space-care-details-v1.jpeg" alt="Detalhes em madeira e iluminação acolhedora no espaço ProHealth" fill sizes="(max-width: 760px) 100vw, 36vw" quality={80} /><figcaption><span>02</span> Presença</figcaption></figure>
        <figure className={styles.galleryFull}><Image src="/images/prohealth-space-pilates-wide-v1.jpeg" alt="Visão ampla dos equipamentos de Pilates na ProHealth" fill sizes="100vw" quality={80} /><figcaption><span>03</span> Precisão</figcaption></figure>
      </div>
    </section>

    <section className={styles.audience} aria-label="Público da ProHealth">
      <p>Para quem leva o corpo a sério.</p>
      <div><span>Atletas profissionais</span><span>Atletas amadores</span><span>Pessoas fisicamente ativas</span></div>
    </section>

    <section className={styles.practical} id="contato" aria-labelledby="practical-title">
      <div className={styles.practicalInfo}>
        <p className={styles.sectionIndex}>04 — INFORMAÇÕES PRÁTICAS</p><h2 id="practical-title">Antes de vir.</h2>
        <dl>
          <div><dt>Endereço</dt><dd>Rua Vera Linhares de Andrade, 2063<br />Córrego Grande · Florianópolis</dd><a href={directionsUrl} target="_blank" rel="noreferrer">Abrir rotas <ArrowIcon /></a></div>
          <div><dt>Horários</dt><dd>Segunda a sexta<br />Primeiro horário às 08h · encerramento às 21h</dd></div>
          <div><dt>Fim de semana</dt><dd>Somente com agendamento prévio para clientes de planos.</dd></div>
        </dl>
      </div>
      <div className={styles.faq}>
        <p className={styles.sectionIndex}>DÚVIDAS FREQUENTES</p><h2>Respostas diretas.</h2>
        <div className={styles.faqList}>{faqItems.map((item) => <details key={item.question}><summary>{item.question}<span aria-hidden="true">+</span></summary><p>{item.answer}</p></details>)}</div>
      </div>
    </section>

    <section className={styles.finalCta} aria-labelledby="final-title">
      <div><p className={styles.sectionIndex}>PRO HEALTH · FLORIANÓPOLIS</p><h2 id="final-title">Seu próximo passo começa com uma conversa.</h2></div>
      <div className={styles.finalActions}>
        <a className={styles.primaryButton} href={whatsappUrl} target="_blank" rel="noreferrer">Falar no WhatsApp <ArrowIcon /></a>
        <a className={styles.secondaryButton} href={plansUrl} target="_blank" rel="noreferrer">Conhecer planos <ArrowIcon /></a>
      </div>
    </section>

    <footer className={styles.footer}>
      <Brand />
      <div><strong>PRO HEALTH FLORIANÓPOLIS</strong><span>Movimento, recuperação e performance.</span></div>
      <div><a href="mailto:prohealthfloripa@gmail.com">prohealthfloripa@gmail.com</a><a href="https://www.instagram.com/prohealthfloripa" target="_blank" rel="noreferrer">@prohealthfloripa</a><a href={whatsappUrl} target="_blank" rel="noreferrer">(48) 99862-1948</a></div>
      <p>© {new Date().getFullYear()} ProHealth Floripa.</p>
    </footer>
  </main>;
}
