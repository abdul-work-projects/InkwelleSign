'use client';
import clsx from 'clsx';
import { PenLine, Type, Calendar, CheckSquare, ChevronDown, Mail, User, Signature } from 'lucide-react';

export const FIELD_TYPES = [
  { type: 'signature', label: 'Signature', icon: Signature, w: 0.26, h: 0.055 },
  { type: 'initials', label: 'Initials', icon: PenLine, w: 0.095, h: 0.042 },
  { type: 'date', label: 'Date signed', icon: Calendar, w: 0.17, h: 0.030 },
  { type: 'text', label: 'Text', icon: Type, w: 0.24, h: 0.030 },
  { type: 'checkbox', label: 'Checkbox', icon: CheckSquare, w: 0.030, h: 0.023 },
  { type: 'dropdown', label: 'Dropdown', icon: ChevronDown, w: 0.20, h: 0.030 },
  { type: 'fullname', label: 'Full name', icon: User, w: 0.24, h: 0.030 },
  { type: 'email', label: 'Email', icon: Mail, w: 0.24, h: 0.030 },
];

export const FIELD_META = Object.fromEntries(FIELD_TYPES.map((f) => [f.type, f]));

export function fieldLabel(field) {
  return field.label || FIELD_META[field.type]?.label || field.type;
}

/** Converts a hex accent into translucent background / solid border styling. */
export function chipStyle(color, selected) {
  return {
    backgroundColor: `${color}1f`,
    borderColor: selected ? color : `${color}99`,
    color,
    boxShadow: selected ? `0 0 0 2px ${color}55` : undefined,
  };
}

export default function FieldChip({ field, color, selected, onPointerDown, onResizePointerDown, className, readOnly }) {
  const Meta = FIELD_META[field.type];
  const Icon = Meta?.icon || Type;
  return (
    <div
      className={clsx(
        'field-chip flex items-center gap-1 px-1.5 overflow-hidden',
        readOnly ? 'cursor-default' : 'cursor-move',
        selected && 'z-20',
        className,
      )}
      style={{
        left: `${field.x * 100}%`, top: `${field.y * 100}%`,
        width: `${field.w * 100}%`, height: `${field.h * 100}%`,
        ...chipStyle(color, selected),
      }}
      onPointerDown={onPointerDown}
    >
      <Icon size={11} className="shrink-0 opacity-80" />
      <span className="truncate font-medium text-[10.5px] leading-none">{fieldLabel(field)}</span>
      {field.required && <span className="ml-auto text-[13px] leading-none opacity-70">*</span>}
      {!readOnly && (
        <span
          onPointerDown={onResizePointerDown}
          className="absolute -right-[3px] -bottom-[3px] w-2.5 h-2.5 rounded-[2px] border border-white cursor-nwse-resize"
          style={{ backgroundColor: color }}
        />
      )}
    </div>
  );
}
