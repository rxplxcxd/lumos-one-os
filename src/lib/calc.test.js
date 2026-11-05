import { describe, it, expect } from 'vitest';
import { evaluate, format } from './calc.js';

describe('calculator', () => {
  it('respects precedence and associativity', () => {
    expect(evaluate('2+3*4')).toBe(14);
    expect(evaluate('(2+3)*4')).toBe(20);
    expect(evaluate('2^3^2')).toBe(512);
    expect(evaluate('-2^2')).toBe(-4);
    expect(evaluate('10/4')).toBe(2.5);
  });
  it('handles unicode operators, percent and implicit multiplication', () => {
    expect(evaluate('6×7')).toBe(42);
    expect(evaluate('9÷3')).toBe(3);
    expect(evaluate('50%')).toBe(0.5);
    expect(evaluate('2π')).toBeCloseTo(2 * Math.PI);
    expect(evaluate('√(16)+1')).toBe(5);
    expect(evaluate('3(2+1)')).toBe(9);
  });
  it('functions in degrees', () => {
    expect(evaluate('sin(30)')).toBeCloseTo(0.5);
    expect(evaluate('cos(60)')).toBeCloseTo(0.5);
    expect(evaluate('log(1000)')).toBeCloseTo(3);
  });
  it('rejects garbage and division by zero', () => {
    expect(() => evaluate('2+')).toThrow();
    expect(() => evaluate('1/0')).toThrow();
    expect(() => evaluate('alert(1)')).toThrow();
  });
  it('formats in German locale', () => {
    expect(format(1234.5)).toBe('1.234,5');
    expect(format(0.1 + 0.2)).toBe('0,3');
  });
});
