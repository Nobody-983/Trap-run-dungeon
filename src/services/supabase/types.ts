import type { CellType, Point } from '../../game/types'

export interface ProfileRecord {
  id: string
  near_account_id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  bio: string | null
  created_at: string
  updated_at: string
}

export interface DungeonGridData {
  cells: CellType[]
  start: Point
  exit: Point
}

export interface DungeonRecord {
  id: string
  creator_near_account: string
  title: string
  description: string | null
  dungeon_hash: string
  canonical_format_version: number
  serialized_dungeon: string
  grid_data: DungeonGridData
  par: number
  difficulty: number
  status: 'draft' | 'published' | 'archived'
  near_registry_id: number | null
  created_at: string
  updated_at: string
}

export interface ChallengeRecord {
  id: string
  dungeon_id: string
  creator_near_account: string
  challenge_code: string
  status: 'active' | 'expired' | 'completed'
  start_time: string | null
  end_time: string | null
  created_at: string
}

export interface DailyChallengeRecord {
  day: string
  dungeon_id: string
  title: string
  par: number
  created_at: string
}

export interface ChallengeAttemptRecord {
  id: string
  challenge_id: string | null
  dungeon_id: string
  player_near_account: string
  attempt_id: string
  replay_data: string
  completion_status: 'win' | 'loss'
  completion_time_ms: number
  moves: number
  validation_status: 'pending' | 'verified' | 'rejected'
  validation_notes: string | null
  submitted_at: string
  validated_at: string | null
}

export interface ScoreRecord {
  id: string
  player_near_account: string
  dungeon_id: string
  challenge_id: string | null
  attempt_id: string | null
  completion_time_ms: number
  moves: number
  score: number
  validation_status: 'verified' | 'rejected'
  created_at: string
}

export interface LeaderboardEntry {
  rank: number
  player_near_account: string
  display_name: string
  avatar_url?: string | null
  score: number
  completion_time_ms: number
  moves: number
  created_at: string
  isYou?: boolean
}

export interface GlobalLeaderboardEntry {
  rank: number
  player_near_account: string
  display_name: string
  avatar_url?: string | null
  total_score: number
  dungeons_cleared: number
  best_time_ms: number
  isYou?: boolean
}

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          near_account_id: string
          username: string | null
          display_name: string | null
          avatar_url: string | null
          bio: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          near_account_id: string
          username?: string | null
          display_name?: string | null
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          near_account_id?: string
          username?: string | null
          display_name?: string | null
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      dungeons: {
        Row: {
          id: string
          creator_near_account: string
          title: string
          description: string | null
          dungeon_hash: string
          canonical_format_version: number
          serialized_dungeon: string
          grid_data: DungeonGridData
          par: number
          difficulty: number
          status: string
          near_registry_id: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          creator_near_account: string
          title: string
          description?: string | null
          dungeon_hash: string
          canonical_format_version?: number
          serialized_dungeon: string
          grid_data: DungeonGridData
          par: number
          difficulty?: number
          status?: string
          near_registry_id?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          creator_near_account?: string
          title?: string
          description?: string | null
          dungeon_hash?: string
          canonical_format_version?: number
          serialized_dungeon?: string
          grid_data?: DungeonGridData
          par?: number
          difficulty?: number
          status?: string
          near_registry_id?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      challenges: {
        Row: {
          id: string
          dungeon_id: string
          creator_near_account: string
          challenge_code: string
          status: string
          start_time: string | null
          end_time: string | null
          created_at: string
        }
        Insert: {
          id?: string
          dungeon_id: string
          creator_near_account: string
          challenge_code: string
          status?: string
          start_time?: string | null
          end_time?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          dungeon_id?: string
          creator_near_account?: string
          challenge_code?: string
          status?: string
          start_time?: string | null
          end_time?: string | null
          created_at?: string
        }
        Relationships: []
      }
      daily_challenges: {
        Row: {
          day: string
          dungeon_id: string
          title: string
          par: number
          created_at: string
        }
        Insert: {
          day: string
          dungeon_id: string
          title: string
          par: number
          created_at?: string
        }
        Update: {
          day?: string
          dungeon_id?: string
          title?: string
          par?: number
          created_at?: string
        }
        Relationships: []
      }
      challenge_attempts: {
        Row: {
          id: string
          challenge_id: string | null
          dungeon_id: string
          player_near_account: string
          attempt_id: string
          replay_data: string
          completion_status: string
          completion_time_ms: number
          moves: number
          validation_status: string
          validation_notes: string | null
          submitted_at: string
          validated_at: string | null
        }
        Insert: {
          id?: string
          challenge_id?: string | null
          dungeon_id: string
          player_near_account: string
          attempt_id: string
          replay_data: string
          completion_status: string
          completion_time_ms: number
          moves: number
          validation_status?: string
          validation_notes?: string | null
          submitted_at?: string
          validated_at?: string | null
        }
        Update: {
          id?: string
          challenge_id?: string | null
          dungeon_id?: string
          player_near_account?: string
          attempt_id?: string
          replay_data?: string
          completion_status?: string
          completion_time_ms?: number
          moves?: number
          validation_status?: string
          validation_notes?: string | null
          submitted_at?: string
          validated_at?: string | null
        }
        Relationships: []
      }
      scores: {
        Row: {
          id: string
          player_near_account: string
          dungeon_id: string
          challenge_id: string | null
          attempt_id: string | null
          completion_time_ms: number
          moves: number
          score: number
          validation_status: string
          created_at: string
        }
        Insert: {
          id?: string
          player_near_account: string
          dungeon_id: string
          challenge_id?: string | null
          attempt_id?: string | null
          completion_time_ms: number
          moves: number
          score: number
          validation_status?: string
          created_at?: string
        }
        Update: {
          id?: string
          player_near_account?: string
          dungeon_id?: string
          challenge_id?: string | null
          attempt_id?: string | null
          completion_time_ms?: number
          moves?: number
          score?: number
          validation_status?: string
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      global_leaderboard: {
        Row: {
          player_near_account: string
          display_name: string | null
          avatar_url: string | null
          total_score: number
          dungeons_cleared: number
          best_time_ms: number
        }
        Relationships: []
      }
      daily_leaderboard: {
        Row: {
          player_near_account: string
          display_name: string | null
          avatar_url: string | null
          score: number
          completion_time_ms: number
          moves: number
          created_at: string
        }
        Relationships: []
      }
    }
    Functions: {
      get_dungeon_leaderboard: {
        Args: {
          p_dungeon_id: string
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          rank: number
          player_near_account: string
          display_name: string
          avatar_url: string | null
          score: number
          completion_time_ms: number
          moves: number
          created_at: string
        }[]
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
