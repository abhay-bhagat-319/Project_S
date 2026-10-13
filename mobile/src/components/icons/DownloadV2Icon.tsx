import React from 'react';
import Svg, { G, Path, SvgProps } from 'react-native-svg';

interface DownloadV2IconProps extends SvgProps {
  size?: number;
  color?: string;
}

export const DownloadV2Icon: React.FC<DownloadV2IconProps> = ({
  size = 22,
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
        {/* Tray / Base */}
        <Path
          d="M21,15 C21,15 21,19 21,19 C21,20.105 20.105,21 19,21 C19,21 5,21 5,21 C3.895,21 3,20.105 3,19 C3,19 3,15 3,15"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Arrow Down */}
        <Path
          d="M12,15 C12,15 12,3 12,3 M7,10 C7,10 12,15 12,15 C12,15 17,10 17,10"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G>
    </Svg>
  );
};

export default DownloadV2Icon;
