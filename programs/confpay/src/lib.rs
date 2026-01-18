use anchor_lang::prelude::*;

declare_id!("3F1SwPzenzZhfKPEQ4VxAvFyvB24qEeWm6E3SSj78Ueo");

#[program]
pub mod confpay {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
