import React from 'react';

export interface FieldProps {
  /** Optional HTML id for linking label and input */
  id?: string;
  /** Form field label */
  label?: React.ReactNode;
  /** Explanatory hint or help text below the label */
  description?: React.ReactNode;
  /** Error message to show invalid input */
  error?: React.ReactNode;
  /** Whether the field is mandatory */
  required?: boolean;
  /** Input element or control */
  children: React.ReactNode;
  /** Additional CSS class names */
  className?: string;
}

/**
 * Standard form field wrapper providing consistent label, description, and error layout.
 */
export function Field({
  id,
  label,
  description,
  error,
  required = false,
  children,
  className = '',
}: FieldProps) {
  const autoId = React.useId();
  const fieldId = id || autoId;
  let renderedChild = children;
  if (React.isValidElement(children)) {
    const childProps = children.props;
    const hasId = childProps && typeof childProps === 'object' && 'id' in childProps && Boolean(childProps.id);
    if (!hasId) {
      renderedChild = React.cloneElement(children, {
        id: fieldId,
      } as React.HTMLAttributes<HTMLElement>);
    }
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor={fieldId}
            className="text-xs font-medium select-none"
            style={{ color: 'var(--text-muted)' }}
          >
            {label}
            {required && <span className="ml-1 text-[var(--accent-red,#EF4444)]">*</span>}
          </label>
        </div>
      )}
      {renderedChild}
      {description && !error && (
        <p
          className="text-[11px] leading-normal select-none"
          style={{ color: 'var(--text-faint)' }}
        >
          {description}
        </p>
      )}
      {error && (
        <p
          className="text-[11px] leading-normal font-medium"
          style={{ color: 'var(--accent-red,#EF4444)' }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
