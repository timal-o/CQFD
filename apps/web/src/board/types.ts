export interface Camera {
  /** Translation écran (px CSS). écran = monde × z + (x, y). */
  x: number
  y: number
  z: number
}

export type Tool = 'select' | 'pen' | 'highlighter' | 'eraser' | 'text' | 'laser' | 'hand'
export type EraserMode = 'stroke' | 'pixel'

export interface ToolSettings {
  tool: Tool
  penColor: string
  penSize: number
  hlColor: string
  hlSize: number
  eraserMode: EraserMode
  textColor: string
}

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Trait en cours de tracé chez un autre participant (éphémère). */
export interface LiveStroke {
  by: string
  id: string
  pageId: string
  tool: 'pen' | 'highlighter'
  color: string
  size: number
  /** Triplets absolus (x, y, pression). */
  pts: number[]
  updatedAt: number
}

export interface LaserPoint {
  x: number
  y: number
  t: number
}

export interface LaserTrail {
  pageId: string
  pts: LaserPoint[]
}

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8
export const LASER_TRAIL_MS = 1500
