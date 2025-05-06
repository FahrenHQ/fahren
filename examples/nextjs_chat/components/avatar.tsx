import React from "react";

interface AvatarProps {
  name: string | undefined;
  size?: number;
  bgColor?: string;
  textColor?: string;
  className?: string;
  uri?: string;
}

const Avatar = ({
  name,
  size = 25,
  bgColor = "#ccc",
  className,
  uri,
}: AvatarProps) => {
  const getInitial = (name: string | undefined) => {
    return name?.trim().charAt(0).toUpperCase();
  };

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: bgColor,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {uri && (
        <img
          src={uri}
          alt="Avatar"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}
      {!uri && name && (
        <svg width={size} height={size} viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="50" fill={bgColor} />
          <text
            x="50"
            y="50"
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="50"
            fill="#18181899"
            fontFamily="Inter, sans-serif"
          >
            {getInitial(name)}
          </text>
        </svg>
      )}
    </div>
  );
};

export default Avatar;
