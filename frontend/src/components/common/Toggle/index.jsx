import React from 'react';

export default function Toggle({ name, checked, onChange, label, disabled = false }) {
  return (
    <label className={`toggle-wrap${disabled ? ' toggle-wrap--disabled' : ''}`}>
      <span className="toggle">
        <input
          type="checkbox"
          name={name}
          checked={checked}
          onChange={onChange}
          disabled={disabled}
        />
        <span className="toggle-track" />
        <span className="toggle-thumb" />
      </span>
      {label && <span className="toggle-label">{label}</span>}
    </label>
  );
}
