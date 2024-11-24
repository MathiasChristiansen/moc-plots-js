export interface FollowEvents {
  onFollowStart?: () => void;
  onFollowStop?: () => void;
}

export interface MouseEvents {
  onMouseDown?: (event: MouseEvent) => void;
  onMouseMove?: (event: MouseEvent) => void;
  onMouseUp?: (event: MouseEvent) => void;
  onMouseLeave?: (event: MouseEvent) => void;
}
