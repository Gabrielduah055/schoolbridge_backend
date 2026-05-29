const digitsOnly = (value: string): string => value.replace(/\D/g, '');

export const normalizePhoneNumber = (value: string): string => {
  if (!value) return '';
  const digits = digitsOnly(value);

  // +233XXXXXXXXX or 233XXXXXXXXX → 0XXXXXXXXX
  if (digits.startsWith('233') && digits.length === 12) {
    return `0${digits.slice(3)}`;
  }

  // 9-digit number missing the leading 0 → 0XXXXXXXXX
  if (digits.length === 9 && !digits.startsWith('0')) {
    return `0${digits}`;
  }

  // Already in local 0XXXXXXXXX format
  if (digits.startsWith('0') && digits.length === 10) {
    return digits;
  }

  // Unknown format — return digits as-is (don't silently corrupt)
  return digits;
};

export const getPhoneLookupCandidates = (value: string): string[] => {
  if (!value) return [];


  const raw = value.trim();
  const digits = digitsOnly(value);
  const normalized = normalizePhoneNumber(value);
  const candidates = new Set<string>();


  //add all raw variations 
  [raw, digits, normalized].forEach(candidate => {
    if (candidate) candidates.add(candidate);
  });

  //from 0244123456 we can have 233244123456 and +233244123456

  if (normalized.startsWith('0') && normalized.length === 10) {
    const withoutLeadingZero = normalized.slice(1);
    candidates.add(withoutLeadingZero);
    candidates.add(`233${withoutLeadingZero}`);
    candidates.add(`+233${withoutLeadingZero}`);
  }

   // From 233XXXXXXXXX format
  if (digits.startsWith('233') && digits.length === 12) {
    candidates.add(`+${digits}`);                 // +233XXXXXXXXX
    candidates.add(`0${digits.slice(3)}`);        // 0XXXXXXXXX
  }

  // From +233XXXXXXXXX format — must check `raw` because digitsOnly() strips '+'
  if (raw.startsWith('+233') && digits.length === 12) {
    const withoutCountryCode = digits.slice(3);
    candidates.add(`0${withoutCountryCode}`);
    candidates.add(`233${withoutCountryCode}`);
    candidates.add(digits); // 233XXXXXXXXX
  }

  return Array.from(candidates).filter(Boolean);
};
