import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const nav = document.querySelector('nav');
  const firstSection = document.querySelector('main > section');
  let heroDelay = 0;

  document.querySelectorAll<HTMLElement>('[data-animate]').forEach((el) => {
    const type = el.getAttribute('data-animate')!;
    const inHero = !!firstSection?.contains(el);
    const onLoad = inHero || !!(nav?.contains(el));
    const delay = inHero ? heroDelay : 0;
    if (inHero) heroDelay += 0.15;

    switch (type) {
      case 'fade-up': {
        const base = { opacity: 0, y: 30, duration: 0.6, ease: 'power2.out' };
        onLoad
          ? gsap.from(el, { ...base, delay })
          : gsap.from(el, { ...base, scrollTrigger: { trigger: el, start: 'top 85%', once: true } });
        break;
      }
      case 'fade-in': {
        const base = { opacity: 0, duration: 0.6, ease: 'power2.out' };
        onLoad
          ? gsap.from(el, { ...base, delay })
          : gsap.from(el, { ...base, scrollTrigger: { trigger: el, start: 'top 85%', once: true } });
        break;
      }
      case 'stagger': {
        const children = Array.from(el.children) as HTMLElement[];
        if (!children.length) return;
        const base = { opacity: 0, y: 30, duration: 0.4, ease: 'power2.out', stagger: 0.1 };
        onLoad
          ? gsap.from(children, { ...base, delay })
          : gsap.from(children, { ...base, scrollTrigger: { trigger: el, start: 'top 85%', once: true } });
        break;
      }
      case 'counter': {
        const rawText = el.textContent ?? '';
        const num = parseFloat(rawText.replace(/[^0-9.]/g, ''));
        if (isNaN(num) || num === 0) return;
        const suffix = rawText.replace(/[0-9.]/g, '');
        const obj = { val: 0 };
        const run = () =>
          gsap.to(obj, {
            val: num,
            duration: 1.5,
            ease: 'power1.out',
            onUpdate() {
              el.textContent = Math.round(obj.val) + suffix;
            },
          });
        onLoad
          ? run()
          : ScrollTrigger.create({ trigger: el, start: 'top 85%', once: true, onEnter: run });
        break;
      }
    }
  });

  document.fonts.ready.then(() => ScrollTrigger.refresh());
}
