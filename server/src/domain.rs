use crate::dto::{
    PlayerTeamDto, ScenarioSideEntityDto, ScenarioSummaryDto, SessionParticipantDto,
    SessionPublicDto,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PlayerTeam {
    Blue,
    Red,
    White,
}

impl PlayerTeam {
    pub fn from_dto(team: PlayerTeamDto) -> Self {
        match team {
            PlayerTeamDto::Blue => PlayerTeam::Blue,
            PlayerTeamDto::Red => PlayerTeam::Red,
            PlayerTeamDto::White => PlayerTeam::White,
        }
    }

    pub fn to_dto(self) -> PlayerTeamDto {
        match self {
            PlayerTeam::Blue => PlayerTeamDto::Blue,
            PlayerTeam::Red => PlayerTeamDto::Red,
            PlayerTeam::White => PlayerTeamDto::White,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SessionPublic {
    pub id: String,
    pub name: String,
}

impl SessionPublic {
    pub fn to_dto(&self) -> SessionPublicDto {
        SessionPublicDto {
            id: self.id.clone(),
            name: self.name.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ScenarioSideEntity {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct ScenarioSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub win_conditions: String,
    pub red: Vec<ScenarioSideEntity>,
    pub blue: Vec<ScenarioSideEntity>,
}

impl ScenarioSideEntity {
    pub fn to_dto(&self) -> ScenarioSideEntityDto {
        ScenarioSideEntityDto {
            id: self.id.clone(),
            name: self.name.clone(),
        }
    }
}

impl ScenarioSummary {
    pub fn to_dto(&self) -> ScenarioSummaryDto {
        ScenarioSummaryDto {
            id: self.id.clone(),
            name: self.name.clone(),
            description: self.description.clone(),
            win_conditions: self.win_conditions.clone(),
            red: self.red.iter().map(|e| e.to_dto()).collect(),
            blue: self.blue.iter().map(|e| e.to_dto()).collect(),
        }
    }
}

pub fn participant_to_dto(
    public: &SessionPublic,
    player_team: PlayerTeam,
    display_name: String,
) -> SessionParticipantDto {
    SessionParticipantDto {
        id: public.id.clone(),
        name: public.name.clone(),
        player_team: player_team.to_dto(),
        display_name,
    }
}

