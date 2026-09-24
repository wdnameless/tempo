import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  Row,
  Toggle,
  Segmented,
  Slider,
  SectionHeader,
  Kbd,
  Divider,
  IconButton,
} from '../index';
import { applyAccent, ACCENTS } from '../../../constants/design';
import { isMacPlatform } from '../../../services/shortcuts';

describe('UI Kit components and design constants', () => {
  describe('applyAccent', () => {
    beforeEach(() => {
      document.documentElement.style.removeProperty('--accent');
      document.documentElement.style.removeProperty('--accent-soft');
    });

    it("applyAccent('blue') sets --accent to the blue value and --accent-soft with alpha", () => {
      applyAccent('blue');
      const root = document.documentElement;
      expect(root.style.getPropertyValue('--accent')).toBe(ACCENTS.blue);
      expect(root.style.getPropertyValue('--accent-soft')).toBe('rgba(59, 130, 246, 0.14)');
    });

    it("applyAccent('amber') sets default amber accent", () => {
      applyAccent('amber');
      const root = document.documentElement;
      expect(root.style.getPropertyValue('--accent')).toBe(ACCENTS.amber);
      expect(root.style.getPropertyValue('--accent-soft')).toBe('rgba(245, 158, 11, 0.14)');
    });
  });

  describe('Toggle', () => {
    it('reports the flipped value through onChange when clicked', () => {
      const onChange = vi.fn();
      render(<Toggle checked={false} onChange={onChange} />);

      const toggle = screen.getByRole('switch');
      expect(toggle.getAttribute('aria-checked')).toBe('false');

      fireEvent.click(toggle);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(true);
    });

    it('reports false when already checked and clicked', () => {
      const onChange = vi.fn();
      render(<Toggle checked={true} onChange={onChange} />);

      const toggle = screen.getByRole('switch');
      expect(toggle.getAttribute('aria-checked')).toBe('true');

      fireEvent.click(toggle);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(false);
    });

    it('does not trigger onChange when disabled', () => {
      const onChange = vi.fn();
      render(<Toggle checked={false} onChange={onChange} disabled />);

      const toggle = screen.getByRole('switch');
      fireEvent.click(toggle);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('contrasts the knob colour with the track colour when checked', () => {
      const { container } = render(<Toggle checked={true} onChange={() => {}} />);
      const track = screen.getByRole('switch');
      const knob = container.querySelector('span');
      expect(knob).not.toBeNull();
      expect(track.style.backgroundColor).toBe('var(--accent)');
      expect(knob?.style.backgroundColor).toBe('var(--accent-fg)');
      expect(track.style.backgroundColor).not.toBe(knob?.style.backgroundColor);
    });

    it('contrasts the knob colour with the track colour and has a visible outline when unchecked', () => {
      const { container } = render(<Toggle checked={false} onChange={() => {}} />);
      const track = screen.getByRole('switch');
      const knob = container.querySelector('span');
      expect(knob).not.toBeNull();
      expect(track.style.backgroundColor).toBe('var(--elevated)');
      expect(knob?.style.backgroundColor).toBe('var(--text-muted)');
      expect(track.style.backgroundColor).not.toBe(knob?.style.backgroundColor);
      expect(track.style.border).toContain('var(--border-strong');
    });
  });

  describe('Segmented', () => {
    const options = [
      { value: 'all', label: 'All' },
      { value: 'active', label: 'Active' },
      { value: 'completed', label: 'Completed' },
    ] as const;

    it("reports the clicked option's value through onChange", () => {
      const onChange = vi.fn();
      render(<Segmented value="all" options={options as unknown as { value: string; label: string }[]} onChange={onChange} />);

      const activeOption = screen.getByRole('radio', { name: 'Active' });
      fireEvent.click(activeOption);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith('active');
    });

    it('does not fire onChange when clicking already selected option', () => {
      const onChange = vi.fn();
      render(<Segmented value="all" options={options as unknown as { value: string; label: string }[]} onChange={onChange} />);

      const allOption = screen.getByRole('radio', { name: 'All' });
      fireEvent.click(allOption);

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('Slider', () => {
    it('clamps to [min,max] and reports a number', () => {
      const onChange = vi.fn();
      render(<Slider value={50} min={10} max={100} onChange={onChange} minLabel="10m" maxLabel="100m" />);

      const slider = screen.getByRole('slider');

      fireEvent.change(slider, { target: { value: '75' } });
      expect(onChange).toHaveBeenCalledWith(75);

      fireEvent.change(slider, { target: { value: '150' } });
      expect(onChange).toHaveBeenCalledWith(100);

      fireEvent.change(slider, { target: { value: '5' } });
      expect(onChange).toHaveBeenCalledWith(10);
    });

    it('renders min and max labels if provided', () => {
      render(<Slider value={25} min={5} max={60} onChange={vi.fn()} minLabel="5 min" maxLabel="60 min" />);

      expect(screen.getByText('5 min')).toBeDefined();
      expect(screen.getByText('60 min')).toBeDefined();
    });
  });

  describe('Row', () => {
    it('disabled Row does not call onPress', () => {
      const onPress = vi.fn();
      render(
        <Row
          label="Auto-start breaks"
          description="Starts break timers automatically"
          onPress={onPress}
          disabled={true}
        />
      );

      const row = screen.getByText('Auto-start breaks').closest('div[aria-disabled="true"]');
      expect(row).not.toBeNull();
      if (row) fireEvent.click(row);

      expect(onPress).not.toHaveBeenCalled();
    });

    it('Row without onPress is not interactive', () => {
      render(
        <Row
          label="Static setting"
          description="Informational only"
        />
      );

      expect(screen.queryByRole('button')).toBeNull();
    });

    it('Row with onPress calls onPress when clicked or key pressed', () => {
      const onPress = vi.fn();
      render(
        <Row
          label="Clickable row"
          description="Tap to open details"
          onPress={onPress}
        />
      );

      const rowButton = screen.getByRole('button');
      fireEvent.click(rowButton);
      expect(onPress).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(rowButton, { key: 'Enter' });
      expect(onPress).toHaveBeenCalledTimes(2);
    });

    it('shows disabled reason when disabled is a string', () => {
      render(
        <Row
          label="Premium feature"
          disabled="Requires active subscription"
        />
      );

      expect(screen.getByText('Requires active subscription')).toBeDefined();
    });
  });

  describe('Kbd', () => {
    it('renders one box per key', () => {
      render(<Kbd keys={['⌘', 'Shift', 'P']} />);

      expect(screen.getByText(isMacPlatform() ? '⌘' : 'Ctrl')).toBeDefined();
      expect(screen.getByText('Shift')).toBeDefined();
      expect(screen.getByText('P')).toBeDefined();

      const kbdElements = document.querySelectorAll('kbd');
      expect(kbdElements.length).toBe(3);
    });
  });

  describe('IconButton', () => {
    it('renders with accessible label and responds to clicks', () => {
      const onClick = vi.fn();
      render(
        <IconButton
          icon={<span data-testid="icon">⚙</span>}
          label="Settings"
          onClick={onClick}
        />
      );

      const btn = screen.getByRole('button', { name: 'Settings' });
      expect(btn).toBeDefined();

      fireEvent.click(btn);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('does not fire onClick when disabled', () => {
      const onClick = vi.fn();
      render(
        <IconButton
          icon={<span>✕</span>}
          label="Close"
          disabled
          onClick={onClick}
        />
      );

      const btn = screen.getByRole('button', { name: 'Close' });
      fireEvent.click(btn);
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe('Divider & SectionHeader', () => {
    it('Divider renders a 1px separator line', () => {
      render(<Divider />);
      const hr = document.querySelector('hr');
      expect(hr).not.toBeNull();
    });

    it('SectionHeader renders uppercase heading', () => {
      render(<SectionHeader>General Settings</SectionHeader>);
      expect(screen.getByRole('heading', { name: 'General Settings', level: 3 })).toBeDefined();
    });
  });
});
