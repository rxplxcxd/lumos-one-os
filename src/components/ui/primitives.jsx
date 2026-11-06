// Shared building blocks: every interactive element is controller-navigable (data-nav),
// spring-animated and wired to the haptics engine.
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { spring } from '@/lib/motion.js';
import { haptic } from '@/services/haptics.js';
import { back, useUI } from '@/store/ui.js';
import { useSettings } from '@/store/settings.js';
import { glyphFor } from '@/lib/controllers.js';
import { keyLabel, resolveBindings } from '@/lib/keybindings.js';

const cx = (...a) => a.filter(Boolean).join(' ');

export function Glass({ className = '', strong = false, children, ...rest }) {
  return (
    <div className={cx(strong ? 'glass-strong' : 'glass', 'rounded-3xl', className)} {...rest}>
      {children}
    </div>
  );
}

export const Button = forwardRef(function Button({ variant = 'glass', size = 'md', className = '', children, icon: Icon, haptics, autoFocus, ...rest }, ref) {
  const base = 'nav-focus inline-flex items-center justify-center gap-2 font-medium select-none whitespace-nowrap';
  const sizes = { sm: 'h-9 px-3.5 text-[0.8rem] rounded-xl', md: 'h-11 px-5 text-[0.9rem] rounded-2xl', lg: 'h-14 px-7 text-base rounded-2xl' };
  const variants = {
    glass: 'glass text-mist-50',
    primary: 'bg-mist-50 text-ink-950',
    ghost: 'bg-transparent text-mist-200 hover:bg-white/5',
    danger: 'bg-bad/15 text-bad border border-bad/25',
    subtle: 'bg-white/[0.06] text-mist-100 border border-white/[0.06]',
  };
  return (
    <motion.button
      ref={ref}
      data-nav=""
      data-nav-autofocus={autoFocus ? '' : undefined}
      data-nav-haptic={haptics}
      whileTap={{ scale: 0.95 }}
      whileFocus={{ scale: 1.03 }}
      transition={spring.snappy}
      className={cx(base, sizes[size], variants[variant], className)}
      {...rest}
    >
      {Icon && <Icon className="h-[1.1em] w-[1.1em]" strokeWidth={2} />}
      {children}
    </motion.button>
  );
});

export function Toggle({ checked, onChange, label, disabled }) {
  const flip = () => {
    if (disabled) return;
    haptic(checked ? 'toggle.off' : 'toggle.on');
    onChange?.(!checked);
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-nav=""
      data-nav-haptic="none"
      disabled={disabled}
      onClick={flip}
      className={cx('nav-focus relative h-[1.9rem] w-[3.2rem] shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-ok' : 'bg-white/15', disabled && 'opacity-40')}
    >
      <motion.span
        layout
        transition={spring.bouncy}
        className="absolute top-[0.18rem] h-[1.54rem] w-[1.54rem] rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.35)]"
        style={{ left: checked ? 'calc(100% - 1.72rem)' : '0.18rem' }}
      />
    </button>
  );
}

export function Slider({ value, min = 0, max = 100, step = 1, onChange, format = (v) => v, detents = 10, label, icon: Icon, className = '' }) {
  const ref = useRef(null);
  const lastDetent = useRef(Math.round(((value - min) / (max - min)) * detents));
  const pct = ((value - min) / (max - min)) * 100;
  const commit = useCallback(
    (v) => {
      const q = Math.round(Math.min(max, Math.max(min, v)) / step) * step;
      const clamped = Number(Math.min(max, Math.max(min, q)).toFixed(4));
      const d = Math.round(((clamped - min) / (max - min)) * detents);
      if (d !== lastDetent.current) {
        lastDetent.current = d;
        haptic(clamped === min || clamped === max ? 'nav.edge' : 'slider.detent');
      }
      onChange?.(clamped);
    },
    [min, max, step, detents, onChange],
  );

  useEffect(() => {
    const el = ref.current;
    const onNav = (e) => {
      const { dir } = e.detail;
      if (dir === 'left' || dir === 'right') {
        e.preventDefault();
        const inc = Math.max(step, (max - min) / 20);
        commit(value + (dir === 'right' ? inc : -inc));
      }
    };
    el.addEventListener('lumos:navkey', onNav);
    return () => el.removeEventListener('lumos:navkey', onNav);
  }, [value, commit, step, min, max]);

  const fromPointer = (e) => {
    const b = ref.current.getBoundingClientRect();
    commit(min + ((e.clientX - b.left) / b.width) * (max - min));
  };

  return (
    <div className={cx('flex items-center gap-3', className)}>
      {Icon && <Icon className="h-5 w-5 shrink-0 text-mist-300" />}
      <div
        ref={ref}
        role="slider"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        data-nav=""
        data-nav-haptic="none"
        className="nav-focus group relative h-8 flex-1 cursor-pointer rounded-full bg-white/[0.08]"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => e.buttons && fromPointer(e)}
      >
        <motion.div className="absolute inset-y-0 left-0 rounded-full bg-mist-50/90" animate={{ width: `${pct}%` }} transition={spring.snappy} style={{ minWidth: '2rem' }} />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-end px-3 text-[0.75rem] font-semibold tabular-nums text-mist-300 mix-blend-difference">{format(value)}</div>
      </div>
    </div>
  );
}

export function Segmented({ options, value, onChange, className = '' }) {
  return (
    <div className={cx('relative flex rounded-2xl bg-white/[0.06] p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            data-nav=""
            data-nav-haptic="none"
            onClick={() => {
              haptic('toggle.on');
              onChange(o.value);
            }}
            className={cx('nav-focus relative z-10 flex-1 rounded-xl px-3 py-2 text-[0.8rem] font-medium transition-colors', active ? 'text-ink-950' : 'text-mist-300')}
          >
            {active && <motion.span layoutId={`seg-${options.map((x) => x.value).join()}`} transition={spring.snappy} className="absolute inset-0 -z-10 rounded-xl bg-mist-50" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ListGroup({ title, footer, children, className = '' }) {
  return (
    <section className={cx('mb-6', className)}>
      {title && <h3 className="label mb-2 px-4">{title}</h3>}
      <div className="glass overflow-hidden rounded-2xl">{children}</div>
      {footer && <p className="mt-2 px-4 text-[0.75rem] leading-relaxed text-mist-400">{footer}</p>}
    </section>
  );
}

export function ListRow({ icon: Icon, iconBg = 'bg-white/10', label, sub, value, onClick, chevron = !!onClick, right, danger, autoFocus, className = '' }) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      data-nav={onClick ? '' : undefined}
      data-nav-autofocus={autoFocus ? '' : undefined}
      onClick={onClick}
      className={cx('row-focus flex min-h-[3.4rem] w-full items-center gap-3.5 border-b border-white/[0.05] px-4 py-2.5 text-left last:border-b-0', className)}
    >
      {Icon && (
        <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.65rem]', iconBg)}>
          <Icon className="h-[1.05rem] w-[1.05rem] text-white" strokeWidth={2} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate text-[0.92rem]', danger ? 'text-bad' : 'text-mist-50')}>{label}</span>
        {sub && <span className="block truncate text-[0.75rem] text-mist-400">{sub}</span>}
      </span>
      {value != null && <span className="shrink-0 text-[0.85rem] text-mist-400">{value}</span>}
      {right}
      {chevron && <ChevronRight className="h-4 w-4 shrink-0 text-mist-500" />}
    </Comp>
  );
}

export function ToggleRow({ checked, onChange, ...rest }) {
  return <ListRow {...rest} right={<Toggle checked={checked} onChange={onChange} label={rest.label} />} />;
}

export function SliderRow({ label, icon, iconBg, ...slider }) {
  return (
    <div className="border-b border-white/[0.05] px-4 py-3 last:border-b-0">
      <div className="mb-2 flex items-center gap-3.5">
        {icon && (
          <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.65rem]', iconBg || 'bg-white/10')}>
            {(() => {
              const I = icon;
              return <I className="h-[1.05rem] w-[1.05rem] text-white" />;
            })()}
          </span>
        )}
        <span className="text-[0.92rem]">{label}</span>
      </div>
      <Slider label={label} {...slider} />
    </div>
  );
}

export function Progress({ value, className = '', thin }) {
  return (
    <div className={cx('overflow-hidden rounded-full bg-white/10', thin ? 'h-1' : 'h-1.5', className)}>
      <motion.div className="h-full rounded-full bg-mist-50" initial={false} animate={{ width: `${Math.max(0, Math.min(100, value))}%` }} transition={spring.soft} />
    </div>
  );
}

export function Sheet({ open, onClose, children, className = '', title }) {
  // portal: sheets must never be positioned relative to an animated (transformed/filtered) screen
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            data-nav-scope="50"
            className={cx('glass-strong relative mb-6 w-[44rem] max-w-[92vw] rounded-[2rem] p-6', className)}
            initial={{ y: 80, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 60, opacity: 0, scale: 0.98 }}
            transition={spring.sheet}
          >
            {title && <h2 className="mb-4 text-xl font-semibold tracking-tight">{title}</h2>}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export const TextField = forwardRef(function TextField({ value, onChange, placeholder, type = 'text', className = '', autoFocus, multiline, onEnter, ...rest }, ref) {
  const Comp = multiline ? 'textarea' : 'input';
  return (
    <Comp
      ref={ref}
      data-nav=""
      data-nav-autofocus={autoFocus ? '' : undefined}
      value={value}
      type={multiline ? undefined : type}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !multiline) onEnter?.();
      }}
      className={cx('nav-focus w-full rounded-2xl border border-white/[0.07] bg-white/[0.06] px-4 py-3 text-[0.95rem] text-mist-50 placeholder:text-mist-500 focus:bg-white/[0.09]', className)}
      {...rest}
    />
  );
});

function Pill({ children }) {
  return <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-white/90 px-1.5 text-[0.62rem] font-bold text-ink-950">{children}</span>;
}

/** Button hint that shows the right glyph for the active input: controller family or bound keyboard key. */
export function Hint({ k, children }) {
  const fam = useUI((s) => s.padFamily);
  const src = useUI((s) => s.inputSource);
  const style = useSettings((s) => s.values.glyphStyle);
  const kb = useSettings((s) => s.values.keyBindings);
  const family = style === 'auto' ? fam : style;
  const label = (key) => (src === 'keyboard' ? keyLabel(resolveBindings(kb)[key]?.[0]) : glyphFor(key, family));
  return (
    <span className="flex items-center gap-1.5 text-[0.75rem] text-mist-300">
      <Pill>{label(k)}</Pill>
      {k === 'lb' && (
        <>
          <span className="-mx-0.5 text-mist-500">/</span>
          <Pill>{label('rb')}</Pill>
        </>
      )}
      {children}
    </span>
  );
}

export function Screen({ title, subtitle, icon: Icon, actions, tabs, tab, onTab, hints, children, className = '', bodyClass = '', noPad }) {
  return (
    <div data-nav-scope="0" className={cx('absolute inset-0 flex flex-col pt-[3.5rem]', className)}>
      <header className="flex items-center gap-4 px-10 pb-4 pt-3">
        <button data-nav="" onClick={() => back()} aria-label="Zurück" className="nav-focus glass flex h-10 w-10 items-center justify-center rounded-full">
          <ChevronLeft className="h-5 w-5" />
        </button>
        {Icon && <Icon className="h-6 w-6 text-mist-200" />}
        <div className="min-w-0">
          <h1 className="truncate text-[1.6rem] font-semibold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-[0.8rem] text-mist-400">{subtitle}</p>}
        </div>
        {tabs && (
          <nav className="ml-6 flex items-center gap-1 rounded-2xl bg-white/[0.05] p-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                data-nav=""
                data-nav-haptic="none"
                onClick={() => {
                  haptic('nav.page');
                  onTab(t.key);
                }}
                className={cx('nav-focus relative rounded-xl px-4 py-1.5 text-[0.85rem] font-medium transition-colors', tab === t.key ? 'text-ink-950' : 'text-mist-300')}
              >
                {tab === t.key && <motion.span layoutId={`tabs-${title}`} transition={spring.snappy} className="absolute inset-0 -z-10 rounded-xl bg-mist-50" />}
                {t.label}
              </button>
            ))}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </header>
      <div className={cx('relative min-h-0 flex-1 overflow-y-auto', noPad ? '' : 'px-10 pb-16', bodyClass)}>{children}</div>
      {hints && (
        <footer className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-center justify-end gap-5 bg-gradient-to-t from-black/50 to-transparent px-10 pb-3 pt-6">{hints}</footer>
      )}
    </div>
  );
}

export function useInterval(fn, ms) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    const t = setInterval(() => saved.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useInterval(() => setNow(new Date()), ms);
  return now;
}

export function Img({ src, fallback, alt = '', className = '', ...rest }) {
  const [s, setS] = useState(src);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setS(src);
    setFailed(false);
  }, [src]);
  if (!s || failed) return fallback ?? <div className={cx('bg-white/5', className)} />;
  return (
    <img
      src={s}
      alt={alt}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => {
        if (rest['data-fallback-src'] && s !== rest['data-fallback-src']) setS(rest['data-fallback-src']);
        else setFailed(true);
      }}
      className={className}
      {...rest}
    />
  );
}
