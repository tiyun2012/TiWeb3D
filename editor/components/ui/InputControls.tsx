import React from 'react';

export const DraggableNumber: React.FC<{ 
  label: string; value: number; onChange: (val: number) => void; step?: number; color?: string; disabled?: boolean;
}> = ({ label, value, onChange, step = 0.01, color, disabled }) => {
  const [localStr, setLocalStr] = React.useState<string>('');
  const [isFocused, setIsFocused] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (!isFocused) {
      setLocalStr(value === undefined || isNaN(value) ? '0.000' : Number(value).toFixed(3));
    }
  }, [value, isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const str = e.target.value;
    setLocalStr(str);
    const parsed = parseFloat(str);
    if (Number.isFinite(parsed)) {
      onChange(parsed);
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    const parsed = parseFloat(localStr);
    if (Number.isFinite(parsed)) {
      onChange(parsed);
      setLocalStr(parsed.toFixed(3));
    } else {
      setLocalStr(value === undefined || isNaN(value) ? '0.000' : Number(value).toFixed(3));
    }
  };

  return (
    <div className={`flex items-center bg-black/20 rounded overflow-hidden border border-transparent ${disabled ? 'opacity-50' : 'focus-within:border-accent'} group`}>
      {label && <div className={`w-6 flex items-center justify-center text-[10px] font-bold h-6 select-none ${color || 'text-text-secondary'}`}>{label}</div>}
      <input 
        type="number" 
        className={`flex-1 bg-transparent text-xs p-1 outline-none text-white min-w-0 text-right pr-2 ${disabled ? 'cursor-not-allowed' : ''}`} 
        value={isFocused ? localStr : (value === undefined || isNaN(value) ? '0.000' : Number(value).toFixed(3))} 
        onChange={handleChange}
        onFocus={() => setIsFocused(true)}
        onBlur={handleBlur}
        step={step}
        disabled={disabled}
        title={label ? `${label} value` : 'Numeric value'}
        aria-label={label ? `${label} value` : 'Numeric value'}
      />
    </div>
  );
};

export const Vector3Input: React.FC<{ 
    label: string; value: {x:number, y:number, z:number}; onChange: (v: {x:number, y:number, z:number}) => void; disabled?: boolean; step?: number;
}> = ({ label, value, onChange, disabled, step }) => (
    <div className="flex flex-col gap-1 mb-2">
        <div className="text-[9px] uppercase text-text-secondary font-bold tracking-wider ml-1 opacity-70">{label}</div>
        <div className="grid grid-cols-3 gap-1">
            <DraggableNumber label="X" value={value?.x ?? 0} onChange={v => onChange({...value, x: v})} color="text-red-500" disabled={disabled} step={step} />
            <DraggableNumber label="Y" value={value?.y ?? 0} onChange={v => onChange({...value, y: v})} color="text-green-500" disabled={disabled} step={step} />
            <DraggableNumber label="Z" value={value?.z ?? 0} onChange={v => onChange({...value, z: v})} color="text-blue-500" disabled={disabled} step={step} />
        </div>
    </div>
);

export const CheckboxInput: React.FC<{
    label: string; checked: boolean; onChange: (val: boolean) => void; disabled?: boolean;
}> = ({ label, checked, onChange, disabled }) => (
    <div className="flex items-center gap-2 py-1">
       <span className="w-24 text-text-secondary text-[10px]">{label}</span>
       <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className={disabled ? 'opacity-50' : ''} />
    </div>
);

export const ColorInput: React.FC<{
    label: string; value: string; onChange: (val: string) => void; disabled?: boolean;
}> = ({ label, value, onChange, disabled }) => (
    <div className="flex items-center gap-2 py-1">
       <span className="w-24 text-text-secondary text-[10px]">{label}</span>
       <input type="color" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={`w-full h-6 bg-transparent border-none cursor-pointer ${disabled ? 'opacity-50' : ''}`} />
    </div>
);

export const RangeInput: React.FC<{
    label: string; value: number; min: number; max: number; step: number; onChange: (val: number) => void; disabled?: boolean;
}> = ({ label, value, min, max, step, onChange, disabled }) => (
    <div className="flex items-center gap-2 py-1">
       <span className="w-24 text-text-secondary text-[10px]">{label}</span>
       <div className="flex-1">
          <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(parseFloat(e.target.value))} className={`w-full ${disabled ? 'opacity-50' : ''}`} />
       </div>
       <span className="w-8 text-right text-[10px]">{Number(value).toFixed(2)}</span>
    </div>
);

export const NumberInput: React.FC<{
    label: string; value: number; step?: number; onChange: (val: number) => void; disabled?: boolean;
}> = ({ label, value, step = 1, onChange, disabled }) => (
    <div className="flex items-center gap-2 py-1">
       <span className="w-24 text-text-secondary text-[10px]">{label}</span>
       <div className="flex-1">
           <DraggableNumber label="" value={value} onChange={onChange} step={step} disabled={disabled} />
       </div>
    </div>
);

export const ModulePropertyPanel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="space-y-2 mb-4">
        <div className="text-[10px] uppercase font-bold text-text-secondary tracking-wider mb-2 border-b border-white/5 pb-1">{title}</div>
        {children}
    </div>
);
