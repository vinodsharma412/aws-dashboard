import React from 'react';

function Button({ children, variant = 'primary', loading = false, ...props }) {
  return (
    <button className={`btn btn-${variant}`} disabled={loading || props.disabled} {...props}>
      {loading ? 'Loading...' : children}
    </button>
  );
}

export default Button;
