/**
 * Calculate attendance metrics
 * P = Present classes
 * T = Total conducted classes
 */
export function calculateAttendance(P: number, T: number) {
  if (T === 0) {
    return {
      percentage: 100,
      isAbove: true,
      message: 'No classes conducted yet.',
      value: 0
    };
  }

  const percentage = (P / T) * 100;
  const isAbove = percentage >= 75;

  if (isAbove) {
    // Safe miss count: x = floor( (P/0.75) - T )
    const x = Math.floor((P / 0.75) - T);
    const message = x > 0 
      ? `You can miss up to ${x} more classes before dropping below 75%.`
      : `You cannot miss any classes. Your next absence will drop you below 75%.`;
    return { percentage, isAbove, message, value: x };
  } else {
    // Recovery attend count: y = max( 0, ceil( 3T - 4P ) )
    const y = Math.max(0, Math.ceil((3 * T) - (4 * P)));
    const message = `You must attend the next ${y} classes consecutively to recover to 75% attendance.`;
    return { percentage, isAbove, message, value: y };
  }
}
