// Einstellungen → Familie & Kindersicherung: roles, profile locks, parental PIN, age ratings,
// daily playtime limits, approved/blocked titles, store approval.
import { useState } from 'react';
import { Users, Lock, ScanFace, KeyRound, Baby, Timer, ShoppingBag, ShieldCheck, Ban, UserRound, Trash2 } from 'lucide-react';
import { ListGroup, ListRow, ToggleRow, Segmented, SliderRow, Button, TextField, Sheet } from '@/components/ui/primitives.jsx';
import { useProfiles, updateProfile, addProfile, removeProfile, activeProfile } from '@/store/profile.js';
import { useParental, ROLES, setParentalPin, hasParentalPin, checkParentalPin, hashPin, minutesToday } from '@/store/parental.js';
import { useLibrary } from '@/store/library.js';
import { askPin } from '@/components/shell/PinPrompt.jsx';
import { openProfilePicker } from '@/components/shell/ProfilePicker.jsx';
import { toast } from '@/store/ui.js';
import { haptic } from '@/services/haptics.js';

async function needParent() {
  if (!hasParentalPin()) return true;
  return askPin({ title: 'Eltern-PIN', check: checkParentalPin });
}

function ChildControls({ p }) {
  const items = useLibrary((s) => s.items);
  const c = p.controls || {};
  const set = (patch) => updateProfile(p.id, { controls: { ...c, ...patch } });
  const toggleList = (key, id) => set({ [key]: (c[key] || []).includes(id) ? c[key].filter((x) => x !== id) : [...(c[key] || []), id] });
  const used = minutesToday(p.id);
  return (
    <>
      <ListGroup title={`Kindersicherung · ${p.name}`} footer={`Heute gespielt: ${used} min${c.dailyMinutes ? ` von ${c.dailyMinutes} min` : ''}`}>
        <div className="border-b border-white/[0.05] px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-[0.92rem]"><Baby className="h-4 w-4" /> Altersfreigabe (USK/PEGI)</div>
          <Segmented value={c.ageLimit ?? 12} onChange={(ageLimit) => set({ ageLimit })} options={[0, 6, 12, 16, 18].map((a) => ({ value: a, label: `ab ${a}` }))} />
        </div>
        <SliderRow icon={Timer} iconBg="bg-[#c27b3a]" label="Tägliche Spielzeit" value={c.dailyMinutes ?? 0} min={0} max={300} step={15} detents={20} format={(x) => (x ? `${x} min` : 'Unbegrenzt')} onChange={(dailyMinutes) => set({ dailyMinutes })} />
        <ToggleRow icon={ShoppingBag} iconBg="bg-[#7c6bb0]" label="Installationen nur mit Eltern-PIN" checked={c.storeNeedsPin !== false} onChange={(storeNeedsPin) => set({ storeNeedsPin })} />
        <ToggleRow icon={ShieldCheck} iconBg="bg-[#3f9c6d]" label="Nur freigegebene Titel" sub="Alles andere ist ausgeblendet" checked={!!c.allowOnlyApproved} onChange={(allowOnlyApproved) => set({ allowOnlyApproved })} />
      </ListGroup>
      <ListGroup title="Titel freigeben / sperren">
        {items.map((it) => {
          const approved = (c.approved || []).includes(it.id);
          const blocked = (c.blocked || []).includes(it.id);
          return (
            <ListRow
              key={it.id}
              label={it.name}
              sub={blocked ? 'Gesperrt' : approved ? 'Freigegeben' : 'Nach Altersfreigabe'}
              chevron={false}
              right={
                <span className="flex gap-2">
                  <Button size="sm" variant={approved ? 'primary' : 'subtle'} icon={ShieldCheck} onClick={() => toggleList('approved', it.id)}>Frei</Button>
                  <Button size="sm" variant={blocked ? 'danger' : 'subtle'} icon={Ban} onClick={() => toggleList('blocked', it.id)}>Sperren</Button>
                </span>
              }
            />
          );
        })}
      </ListGroup>
    </>
  );
}

export default function FamilySection() {
  const { profiles } = useProfiles();
  const active = useProfiles(activeProfile);
  useParental((s) => s.pin);
  const [sel, setSel] = useState(active?.id);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [newRole, setNewRole] = useState('child');
  const p = profiles.find((x) => x.id === sel) || active;
  const isOwner = (active?.role || 'owner') === 'owner';

  const guarded = async (fn) => {
    if (!isOwner && !(await needParent())) return;
    await fn();
  };
  const setLock = async (lock) => {
    if (lock === 'pin') {
      const pin = await askPin({ title: `Neue PIN für ${p.name}`, sub: '4–8 Ziffern, mit OK bestätigen' });
      if (!pin) return;
      updateProfile(p.id, { lock: 'pin', pinHash: await hashPin(pin) });
    } else updateProfile(p.id, { lock, pinHash: lock === 'none' ? null : p.pinHash });
    haptic('success');
  };

  return (
    <>
      <ListGroup title="Profile auf diesem Gerät">
        {profiles.map((x) => (
          <ListRow key={x.id} icon={UserRound} iconBg={x.id === p?.id ? 'bg-[#3b82c4]' : 'bg-[#5b6b8c]'} label={x.name} sub={`${ROLES[x.role || 'owner'].label}${x.lock && x.lock !== 'none' ? ` · ${x.lock === 'faceid' ? 'Face ID' : 'PIN'}` : ''}${x.id === active?.id ? ' · aktiv' : ''}`} onClick={() => setSel(x.id)} />
        ))}
        <ListRow icon={Users} iconBg="bg-[#3f9c6d]" label="Profil hinzufügen" onClick={() => guarded(async () => setAdding(true))} />
        <ListRow icon={Users} iconBg="bg-[#6b7280]" label="Profil wechseln …" onClick={openProfilePicker} />
      </ListGroup>

      {p && (
        <ListGroup title={`Einstellungen für ${p.name}`}>
          <div className="border-b border-white/[0.05] px-4 py-3">
            <div className="mb-2 text-[0.92rem]">Rolle</div>
            <Segmented value={p.role || 'owner'} onChange={(r) => guarded(async () => updateProfile(p.id, { role: r, controls: r === 'child' ? p.controls || { ageLimit: 12, dailyMinutes: 90, blocked: [], approved: [], storeNeedsPin: true } : p.controls }))} options={Object.entries(ROLES).map(([value, r]) => ({ value, label: r.label }))} />
            <div className="mt-2 text-[0.72rem] text-mist-500">{ROLES[p.role || 'owner'].desc}</div>
          </div>
          <div className="border-b border-white/[0.05] px-4 py-3">
            <div className="mb-2 flex items-center gap-2 text-[0.92rem]"><Lock className="h-4 w-4" /> Profilsperre</div>
            <Segmented value={p.lock || 'none'} onChange={(l) => guarded(() => setLock(l))} options={[{ value: 'none', label: 'Keine' }, { value: 'pin', label: 'PIN' }, { value: 'faceid', label: 'Face ID' }]} />
            {p.lock === 'faceid' && <div className="mt-2 flex items-center gap-1.5 text-[0.72rem] text-mist-500"><ScanFace className="h-3.5 w-3.5" /> Face ID nutzt die auf dem Gerät eingerichteten Gesichter (Howdy).</div>}
          </div>
          {profiles.length > 1 && p.id !== active?.id && <ListRow icon={Trash2} iconBg="bg-bad" label="Profil löschen" danger onClick={() => guarded(async () => (removeProfile(p.id), setSel(active.id)))} />}
        </ListGroup>
      )}

      <ListGroup title="Eltern-PIN" footer="Schützt Kinder- und Gastprofile: Installationen, gesperrte Bereiche und Änderungen an der Kindersicherung.">
        <ListRow
          icon={KeyRound}
          iconBg="bg-[#c27b3a]"
          label={hasParentalPin() ? 'Eltern-PIN ändern' : 'Eltern-PIN festlegen'}
          onClick={() =>
            guarded(async () => {
              const pin = await askPin({ title: 'Neue Eltern-PIN', sub: '4–8 Ziffern, mit OK bestätigen' });
              if (!pin) return;
              await setParentalPin(pin);
              toast({ title: 'Eltern-PIN gespeichert', kind: 'success' });
            })
          }
        />
        {hasParentalPin() && <ListRow label="Eltern-PIN entfernen" danger onClick={() => guarded(async () => setParentalPin(null))} />}
      </ListGroup>

      {p?.role === 'child' && <ChildControls p={p} />}

      <Sheet open={adding} onClose={() => setAdding(false)} title="Neues Profil">
        <TextField autoFocus value={name} onChange={setName} placeholder="Name" />
        <Segmented value={newRole} onChange={setNewRole} options={['standard', 'child', 'guest'].map((r) => ({ value: r, label: ROLES[r].label }))} className="mt-3" />
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={() => name && (setSel(addProfile(name, newRole)), setAdding(false), setName(''), haptic('success'))}>Erstellen</Button>
        </div>
      </Sheet>
    </>
  );
}
