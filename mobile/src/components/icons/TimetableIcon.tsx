import React from 'react';
import Svg, { G, Path, SvgProps } from 'react-native-svg';

interface TimetableIconProps extends SvgProps {
  size?: number;
  color?: string;
}

export const TimetableIcon: React.FC<TimetableIconProps> = ({
  size = 28,
  color = '#FFFFFF',
  style,
  ...props
}) => {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      style={style}
      {...props}
    >
      <G transform="translate(4, 4)">
        {/* Outer Circle */}
        <Path
          d="M12,2 C17.523,2 22,6.477 22,12 C22,17.523 17.523,22 12,22 C6.477,22 2,17.523 2,12 C2,6.477 6.477,2 12,2 Z"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Minute Hand */}
        <Path
          d="M12,12 L16,14"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Hour Hand */}
        <Path
          d="M12,6 L12,12"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G>
    </Svg>
  );
};

export default TimetableIcon;
